<script lang="ts">
	import { marked } from 'marked';
	import { toast } from 'svelte-sonner';
	import fileSaver from 'file-saver';

	const { saveAs } = fileSaver;

	import dayjs from '$lib/dayjs';
	import duration from 'dayjs/plugin/duration';
	import relativeTime from 'dayjs/plugin/relativeTime';

	dayjs.extend(duration);
	dayjs.extend(relativeTime);

	async function loadLocale(locales) {
		for (const locale of locales) {
			try {
				dayjs.locale(locale);
				break; // Stop after successfully loading the first available locale
			} catch (error) {
				console.error(`Could not load locale '${locale}':`, error);
			}
		}
	}

	import { onMount, getContext, onDestroy } from 'svelte';

	const i18n = getContext('i18n');
	let isRtl = false;
	$: isRtl =
		['fa', 'fa-IR', 'fa_IR'].includes($i18n?.language) || ($i18n?.language ?? '').startsWith('fa-');
	// Assuming $i18n.languages is an array of language codes
	$: loadLocale($i18n.languages);

	import { goto } from '$app/navigation';
	import { WEBUI_NAME, config, user, pinnedNotes } from '$lib/stores';
	import {
		createNewNote,
		deleteNoteById,
		getNoteById,
		getNoteList,
		searchNotes,
		toggleNotePinnedStatusById,
		getPinnedNoteList
	} from '$lib/apis/notes';
	import { capitalizeFirstLetter, copyToClipboard, getTimeRange } from '$lib/utils';
	import { downloadPdf, createNoteHandler } from './utils';

	import EllipsisHorizontal from '../icons/EllipsisHorizontal.svelte';
	import DeleteConfirmDialog from '$lib/components/common/ConfirmDialog.svelte';
	import Search from '../icons/Search.svelte';
	import Plus from '../icons/Plus.svelte';
	import ChevronRight from '../icons/ChevronRight.svelte';
	import Spinner from '../common/Spinner.svelte';
	import Tooltip from '../common/Tooltip.svelte';
	import NoteMenu from './Notes/NoteMenu.svelte';
	import FilesOverlay from '../chat/MessageInput/FilesOverlay.svelte';
	import XMark from '../icons/XMark.svelte';
	import DropdownOptions from '../common/DropdownOptions.svelte';
	import Loader from '../common/Loader.svelte';

	let loaded = false;

	let importFiles = '';
	let selectedNote = null;
	let showDeleteConfirm = false;

	let notes = {};

	let items = null;
	let total = null;

	let query = '';
	let searchDebounceTimer: ReturnType<typeof setTimeout>;

	let sortKey = null;
	let displayOption = null;
	let viewOption = null;
	let permission = null;

	let page = 1;

	let itemsLoading = false;
	let allItemsLoaded = false;

	const downloadHandler = async (type) => {
		// Fetch the full note since the list response may not contain full content
		const note = await getNoteById(localStorage.token, selectedNote.id).catch((error) => {
			toast.error(`${error}`);
			return null;
		});

		if (!note) return;

		if (type === 'txt') {
			const blob = new Blob([note.data.content.md], { type: 'text/plain' });
			saveAs(blob, `${note.title}.txt`);
		} else if (type === 'md') {
			const blob = new Blob([note.data.content.md], { type: 'text/markdown' });
			saveAs(blob, `${note.title}.md`);
		} else if (type === 'pdf') {
			try {
				await downloadPdf(note);
			} catch (error) {
				toast.error(`${error}`);
			}
		}
	};

	const deleteNoteHandler = async (id) => {
		const res = await deleteNoteById(localStorage.token, id).catch((error) => {
			toast.error(`${error}`);
			return null;
		});

		if (res) {
			init();
		}
	};

	const inputFilesHandler = async (inputFiles) => {
		// Check if all the file is a markdown file and extract name and content

		for (const file of inputFiles) {
			if (file.type !== 'text/markdown') {
				toast.error($i18n.t('Only markdown files are allowed'));
				return;
			}

			const reader = new FileReader();
			reader.onload = async (event) => {
				const content = event.target.result;
				let name = file.name.replace(/\.md$/, '');

				if (typeof content !== 'string') {
					toast.error($i18n.t('Invalid file content'));
					return;
				}

				// Create a new note with the content
				const res = await createNewNote(localStorage.token, {
					title: name,
					data: {
						content: {
							json: null,
							html: marked.parse(content ?? ''),
							md: content
						}
					},
					meta: null,
					access_grants: []
				}).catch((error) => {
					toast.error(`${error}`);
					return null;
				});

				if (res) {
					init();
				}
			};

			reader.readAsText(file);
		}
	};

	const reset = () => {
		page = 1;
		items = null;
		total = null;
		allItemsLoaded = false;
		itemsLoading = false;
		notes = {};
	};

	const loadMoreItems = async () => {
		if (allItemsLoaded) return;
		page += 1;
		await getItemsPage();
	};

	const init = async () => {
		reset();
		await getItemsPage();
	};

	$: if (query !== undefined) {
		clearTimeout(searchDebounceTimer);
		searchDebounceTimer = setTimeout(() => {
			if (loaded) {
				init();
			}
		}, 300);
	}

	$: if (loaded && sortKey !== undefined && permission !== undefined && viewOption !== undefined) {
		init();
	}

	const getItemsPage = async () => {
		itemsLoading = true;

		if (viewOption === 'created') {
			permission = null;
		}

		const res = await searchNotes(
			localStorage.token,
			query,
			viewOption,
			permission,
			sortKey,
			page
		).catch(() => {
			return [];
		});

		if (res) {
			console.log(res);
			total = res.total;
			const pageItems = res.items;

			if ((pageItems ?? []).length === 0) {
				allItemsLoaded = true;
			} else {
				allItemsLoaded = false;
			}

			if (items) {
				const existingIds = new Set(items.map((item) => item.id));
				const newItems = pageItems.filter((item) => !existingIds.has(item.id));
				items = [...items, ...newItems];
			} else {
				items = pageItems;
			}
		}

		itemsLoading = false;
		return res;
	};

	const groupNotes = (res) => {
		if (!Array.isArray(res)) {
			return []; // Return empty array for invalid input
		}

		// Build the grouped object while tracking order
		const grouped: Record<string, any[]> = {};
		const orderedKeys: string[] = [];

		for (const note of res) {
			const timeRange = getTimeRange(note.updated_at / 1000000000);
			if (!grouped[timeRange]) {
				grouped[timeRange] = [];
				orderedKeys.push(timeRange);
			}
			grouped[timeRange].push({
				...note,
				timeRange
			});
		}

		// Return as array of [timeRange, notes] to preserve insertion order
		return orderedKeys.map((key) => [key, grouped[key]] as [string, any[]]);
	};

	let dragged = false;

	const onDragOver = (e) => {
		e.preventDefault();

		// Check if a file is being dragged.
		if (e.dataTransfer?.types?.includes('Files')) {
			dragged = true;
		} else {
			dragged = false;
		}
	};

	const onDragLeave = () => {
		dragged = false;
	};

	const onDrop = async (e) => {
		e.preventDefault();
		console.log(e);

		if (e.dataTransfer?.files) {
			const inputFiles = Array.from(e.dataTransfer?.files);
			if (inputFiles && inputFiles.length > 0) {
				console.log(inputFiles);
				inputFilesHandler(inputFiles);
			}
		}

		dragged = false;
	};

	onMount(() => {
		viewOption = localStorage?.noteViewOption ?? null;
		displayOption = localStorage?.noteDisplayOption ?? null;

		loaded = true;

		const dropzoneElement = document.getElementById('notes-container');
		dropzoneElement?.addEventListener('dragover', onDragOver);
		dropzoneElement?.addEventListener('drop', onDrop);
		dropzoneElement?.addEventListener('dragleave', onDragLeave);

		return () => {
			clearTimeout(searchDebounceTimer);

			if (dropzoneElement) {
				dropzoneElement?.removeEventListener('dragover', onDragOver);
				dropzoneElement?.removeEventListener('drop', onDrop);
				dropzoneElement?.removeEventListener('dragleave', onDragLeave);
			}
		};
	});
</script>

<svelte:head>
	<title>
		{$i18n.t('Notes')} • {$WEBUI_NAME}
	</title>
</svelte:head>

<FilesOverlay show={dragged} />

<div id="notes-container" class="w-full min-h-full h-full px-3 md:px-[18px]" dir={isRtl ? 'rtl' : 'ltr'}>
	{#if loaded}
		<DeleteConfirmDialog
			bind:show={showDeleteConfirm}
			title={$i18n.t('Delete note?')}
			on:confirm={() => {
				deleteNoteHandler(selectedNote.id);
				showDeleteConfirm = false;
			}}
		>
			<div class=" text-sm text-gray-500 truncate">
				{$i18n.t('This will delete')} <span class="  font-semibold">{selectedNote.title}</span>.
			</div>
		</DeleteConfirmDialog>

		<div class="flex flex-col gap-1 px-1 mt-1.5 mb-3">
			<div class="grid grid-cols-[1fr_auto] items-center gap-2">
				<div class={`flex items-center md:self-center text-xl font-medium px-0.5 gap-2 shrink-0 ${isRtl ? 'justify-self-end text-right' : 'justify-self-start'}`}>
					<div>
						{isRtl ? 'یادداشت‌ها' : $i18n.t('Notes')}
					</div>

					<div class="text-lg font-medium text-gray-500 dark:text-gray-500">
						{total}
					</div>
				</div>

				<div class={`flex w-full gap-1.5 ${isRtl ? 'justify-self-start justify-start' : 'justify-self-end justify-end'}`}>
					<button
						class={`px-2 py-1.5 rounded-xl bg-black text-white dark:bg-white dark:text-black transition font-medium text-sm flex items-center gap-1.5 ${isRtl ? 'flex-row-reverse' : ''}`}
						on:click={async () => {
							const res = await createNoteHandler(dayjs().format('YYYY-MM-DD'));

							if (res) {
								goto(`/notes/${res.id}`);
							}
						}}
					>
						<Plus className="size-3" strokeWidth="2.5" />

						<div class="text-xs">{isRtl ? 'یادداشت جدید' : $i18n.t('New Note')}</div>
					</button>
				</div>
			</div>
		</div>

		<div
			class="py-2 bg-white dark:bg-gray-900 rounded-3xl border border-gray-100/30 dark:border-gray-850/30"
			dir={isRtl ? 'rtl' : 'ltr'}
		>
			<div class="px-3.5 pb-2">
				<div class={`grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_auto] ${isRtl ? 'lg:grid-cols-[minmax(0,1fr)_auto]' : ''}`}>
					<div class="min-w-0">
						<div class={`grid grid-cols-[1fr_auto] items-center gap-2 rounded-2xl border border-gray-100/30 dark:border-gray-850/30 bg-white/50 dark:bg-gray-900/40 px-3 py-2 ${isRtl ? 'text-right' : ''}`}>
							<div class={`flex items-center min-w-0 ${isRtl ? 'flex-row-reverse justify-self-end' : ''}`}>
								<div class={isRtl ? 'ml-2 shrink-0' : 'ml-1 mr-3 shrink-0'}>
									<Search className="size-3.5" />
								</div>
								<input
									class={`w-full min-w-0 bg-transparent text-sm outline-hidden ${isRtl ? 'pr-2 text-right' : 'text-start'}`}
									bind:value={query}
									placeholder={isRtl ? 'جستجوی یادداشت‌ها' : $i18n.t('Search Notes')}
									dir={isRtl && !query ? 'rtl' : 'auto'}
								/>

								{#if query}
									<div class={`self-center translate-y-[0.5px] bg-transparent ${isRtl ? 'pr-1.5' : 'pl-1.5'}`}>
										<button
											class="p-0.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-900 transition"
											on:click={() => {
												query = '';
											}}
										>
											<XMark className="size-3" strokeWidth="2" />
										</button>
									</div>
								{/if}
							</div>

							<div class={`flex items-center gap-2 ${isRtl ? 'justify-end' : 'justify-start'}`} />
						</div>

						<div class={`mt-2 flex flex-wrap gap-2 text-sm ${isRtl ? 'justify-end' : 'justify-start'}`}>
							<DropdownOptions
								align={isRtl ? 'end' : 'start'}
								bind:value={viewOption}
								items={[
									{ value: null, label: $i18n.t('All') },
									{ value: 'created', label: $i18n.t('Created by you') },
									{ value: 'shared', label: $i18n.t('Shared with you') }
								]}
								onChange={(value) => {
									if (value) {
										localStorage.noteViewOption = value;
									} else {
										delete localStorage.noteViewOption;
									}
								}}
							/>

							{#if [null, 'shared'].includes(viewOption)}
								<DropdownOptions
									align={isRtl ? 'end' : 'start'}
									bind:value={permission}
									items={[
										{ value: null, label: $i18n.t('Write') },
										{ value: 'read_only', label: $i18n.t('Read Only') }
									]}
								/>
							{/if}
						</div>
					</div>

					<div class={`flex shrink-0 items-start ${isRtl ? 'justify-self-start' : 'justify-self-end'}`}>
						<DropdownOptions
							align={isRtl ? 'end' : 'start'}
							bind:value={displayOption}
							items={[
								{ value: null, label: isRtl ? 'فهرست' : $i18n.t('List') },
								{ value: 'grid', label: $i18n.t('Grid') }
							]}
							onChange={() => {
								if (displayOption) {
									localStorage.noteDisplayOption = displayOption;
								} else {
									delete localStorage.noteDisplayOption;
								}
							}}
						/>
					</div>
				</div>
			</div>

			{#if items !== null && total !== null}
				{#if (items ?? []).length > 0}
					{@const groupedNotes = groupNotes(items)}

					<div class="@container h-full py-2.5 px-2.5">
						<div class="">
							{#each groupedNotes as [timeRange, notesList], idx}
								<div class={`w-full text-xs text-gray-500 dark:text-gray-500 font-medium px-2.5 pb-2.5 ${isRtl ? 'text-right' : ''}`}>
									{$i18n.t(timeRange)}
								</div>

								{#if displayOption === null}
									<div class={`${groupedNotes.length - 1 !== idx ? 'mb-3' : ''} flex flex-col gap-2`}>
										{#each notesList as note, idx (note.id)}
											<div
												class={`flex cursor-pointer w-full items-start gap-2 px-3.5 py-2 border border-gray-50 dark:border-gray-850/30 bg-transparent dark:hover:bg-gray-850 hover:bg-white rounded-2xl transition ${isRtl ? 'flex-row-reverse' : ''}`}
											>
												<div class="min-w-0 flex-1">
													<a href={`/notes/${note.id}`} class="block w-full min-w-0" dir={isRtl ? 'rtl' : 'ltr'}>
														<div class={`text-sm font-medium capitalize line-clamp-1 ${isRtl ? 'text-right' : ''}`}>
															{note.title}
														</div>

														<div class={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-500 ${isRtl ? 'justify-end' : 'justify-start'} ${isRtl ? 'text-right' : ''}`}>
															<span dir="ltr">{dayjs(note.updated_at / 1000000).fromNow()}</span>
															<span aria-hidden="true">·</span>
															<span dir="auto">
																{$i18n.t('By {{name}}', {
																	name: capitalizeFirstLetter(
																		note?.user?.name ??
																			note?.user?.email ??
																			$i18n.t('Deleted User')
																	)
																})}
															</span>
														</div>
													</a>
												</div>

												<NoteMenu
														onDownload={(type) => {
															selectedNote = note;

															downloadHandler(type);
														}}
														onCopyLink={async () => {
															const baseUrl = window.location.origin;
															const res = await copyToClipboard(`${baseUrl}/notes/${note.id}`);

															if (res) {
																toast.success($i18n.t('Copied link to clipboard'));
															} else {
																toast.error($i18n.t('Failed to copy link'));
															}
														}}
														onDelete={() => {
															selectedNote = note;
															showDeleteConfirm = true;
														}}
														isPinned={note.is_pinned ?? false}
														onPin={async () => {
															await toggleNotePinnedStatusById(localStorage.token, note.id);
															pinnedNotes.set(
																await getPinnedNoteList(localStorage.token).catch(() => [])
															);
															init();
														}}
														>
														<button
															class="shrink-0 self-start w-fit p-1 text-sm rounded-xl dark:text-gray-300 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5"
															type="button"
															aria-label={$i18n.t('More')}
														>
															<EllipsisHorizontal className="size-5" />
														</button>
													</NoteMenu>
											</div>
										{/each}
									</div>
								{:else if displayOption === 'grid'}
									<div
										class="{groupedNotes.length - 1 !== idx
											? 'mb-5'
											: ''} gap-2.5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
									>
										{#each notesList as note, idx (note.id)}
											<div
												class={`flex cursor-pointer w-full px-4.5 py-4 border border-gray-50 dark:border-gray-850/30 bg-transparent dark:hover:bg-gray-850 hover:bg-white rounded-2xl transition ${isRtl ? 'flex-row-reverse' : 'space-x-4'}`}
											>
												<div class={`flex flex-1 cursor-pointer w-full ${isRtl ? 'flex-row-reverse' : 'space-x-4'}`}>
													<a
														href={`/notes/${note.id}`}
														class="w-full -translate-y-0.5 flex flex-col justify-between"
														dir={isRtl ? 'rtl' : 'ltr'}
													>
														<div class="flex-1">
															<div
																class={`flex items-center gap-2 self-center mb-1 justify-between ${isRtl ? 'flex-row-reverse' : ''}`}
															>
																<div class={`font-semibold line-clamp-1 capitalize ${isRtl ? 'text-right' : ''}`}>
																	{note.title}
																</div>

																<div>
																	<NoteMenu
																		onDownload={(type) => {
																			selectedNote = note;

																			downloadHandler(type);
																		}}
																		onCopyLink={async () => {
																			const baseUrl = window.location.origin;
																			const res = await copyToClipboard(
																				`${baseUrl}/notes/${note.id}`
																			);

																			if (res) {
																				toast.success($i18n.t('Copied link to clipboard'));
																			} else {
																				toast.error($i18n.t('Failed to copy link'));
																			}
																		}}
																		onDelete={() => {
																			selectedNote = note;
																			showDeleteConfirm = true;
																		}}
																		isPinned={note.is_pinned ?? false}
																		onPin={async () => {
																			await toggleNotePinnedStatusById(localStorage.token, note.id);
																			pinnedNotes.set(
																				await getPinnedNoteList(localStorage.token).catch(() => [])
																			);
																			init();
																		}}
																	>
																		<button
																			class="self-center w-fit text-sm p-1 dark:text-gray-300 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-xl"
																			type="button"
																		>
																			<EllipsisHorizontal className="size-5" />
																		</button>
																	</NoteMenu>
																</div>
															</div>

															<div class={`text-xs text-gray-500 dark:text-gray-500 mb-3 line-clamp-3 min-h-10 ${isRtl ? 'text-right' : ''}`} dir={isRtl ? 'auto' : 'ltr'}>
																{#if note.data?.content?.md}
																	{note.data?.content?.md}
																{:else}
																	{$i18n.t('No content')}
																{/if}
															</div>
														</div>

														<div class={`text-xs px-0.5 w-full flex justify-between items-center ${isRtl ? 'flex-row-reverse' : ''}`}>
															<div dir="ltr">
																{dayjs(note.updated_at / 1000000).fromNow()}
															</div>
															<Tooltip
																content={note?.user?.email ?? $i18n.t('Deleted User')}
																className="flex shrink-0"
																placement="top-start"
															>
																<div class="shrink-0 text-gray-500" dir="auto">
																	{$i18n.t('By {{name}}', {
																		name: capitalizeFirstLetter(
																			note?.user?.name ??
																				note?.user?.email ??
																				$i18n.t('Deleted User')
																		)
																	})}
																</div>
															</Tooltip>
														</div>
													</a>
												</div>
											</div>
										{/each}
									</div>
								{/if}
							{/each}

							{#if !allItemsLoaded}
								<Loader
									on:visible={(e) => {
										if (!itemsLoading) {
											loadMoreItems();
										}
									}}
								>
									<div
										class="w-full flex justify-center py-4 text-xs animate-pulse items-center gap-2"
									>
										<Spinner className=" size-4" />
										<div class=" ">{$i18n.t('Loading...')}</div>
									</div>
								</Loader>
							{/if}
						</div>
					</div>
				{:else}
					<div class="w-full h-full flex flex-col items-center justify-center" dir={isRtl ? 'rtl' : 'ltr'}>
						<div class="py-20 text-center">
							<div class="text-sm text-gray-400 dark:text-gray-600">
								{isRtl ? 'هنوز یادداشتی ندارید' : $i18n.t('No Notes')}
							</div>

							<div class="mt-1 text-xs text-gray-300 dark:text-gray-700">
								{isRtl
									? 'برای ساخت اولین یادداشت، روی «یادداشت جدید» کلیک کنید.'
									: $i18n.t('Create your first note by clicking on the plus button below.')}
							</div>
						</div>
					</div>
				{/if}
			{:else}
				<div class="w-full h-full flex justify-center items-center py-10">
					<Spinner className="size-4" />
				</div>
			{/if}
		</div>
	{:else}
		<div class="w-full h-full flex justify-center items-center">
			<Spinner className="size-4" />
		</div>
	{/if}
</div>
