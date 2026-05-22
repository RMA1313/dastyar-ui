const packages = [
	'micropip',
	'packaging',
	'requests',
	'beautifulsoup4',
	'numpy',
	'pandas',
	'matplotlib',
	'scikit-learn',
	'scipy',
	'regex',
	'sympy',
	'tiktoken',
	'seaborn',
	'pytz',
	'black',
	'openai',
	'openpyxl'
];

// Pure-Python packages whose wheels must be downloaded from PyPI and saved into
// static/pyodide/ so that the browser can install them offline via micropip.
// Packages already provided by the Pyodide distribution (click, platformdirs,
// typing_extensions, etc.) do NOT need to be listed here.
const pypiPackages = ['black', 'pathspec', 'mypy_extensions', 'pytokens'];

import { loadPyodide } from 'pyodide';
import { setGlobalDispatcher, ProxyAgent } from 'undici';
import { writeFile, readFile, copyFile, readdir, rmdir, access } from 'fs/promises';

const useNexus = String(process.env.USE_NEXUS || '').toLowerCase() === 'true';
const nexusBaseUrl = process.env.NEXUS_BASE_URL || 'http://host.docker.internal:8081/repository';
const pypiIndexUrl = 'https://pypi.org/pypi';

/**
 * Loading network proxy configurations from the environment variables.
 * And the proxy config with lowercase name has the highest priority to use.
 */
function initNetworkProxyFromEnv() {
	// we assume all subsequent requests in this script are HTTPS:
	// https://cdn.jsdelivr.net
	// https://pypi.org
	// https://files.pythonhosted.org
	const allProxy = process.env.all_proxy || process.env.ALL_PROXY;
	const httpsProxy = process.env.https_proxy || process.env.HTTPS_PROXY;
	const httpProxy = process.env.http_proxy || process.env.HTTP_PROXY;
	const preferedProxy = httpsProxy || allProxy || httpProxy;
	/**
	 * use only http(s) proxy because socks5 proxy is not supported currently:
	 * @see https://github.com/nodejs/undici/issues/2224
	 */
	if (!preferedProxy || !preferedProxy.startsWith('http')) return;
	let preferedProxyURL;
	try {
		preferedProxyURL = new URL(preferedProxy).toString();
	} catch {
		console.warn(`Invalid network proxy URL: "${preferedProxy}"`);
		return;
	}
	const dispatcher = new ProxyAgent({ uri: preferedProxyURL });
	setGlobalDispatcher(dispatcher);
	console.log(`Initialized network proxy "${preferedProxy}" from env`);
}

async function downloadPackages() {
	console.log('Setting up pyodide + micropip');

	let pyodide;
	try {
		pyodide = await loadPyodide({
			packageCacheDir: 'static/pyodide'
		});
	} catch (err) {
		console.error('Failed to load Pyodide:', err);
		return;
	}

	const packageJson = JSON.parse(await readFile('package.json'));
	const pyodideVersion = packageJson.dependencies.pyodide.replace('^', '');

	try {
		const pyodidePackageJson = JSON.parse(await readFile('static/pyodide/package.json'));
		const pyodidePackageVersion = pyodidePackageJson.version.replace('^', '');

		if (pyodideVersion !== pyodidePackageVersion) {
			console.log('Pyodide version mismatch, removing static/pyodide directory');
			await rmdir('static/pyodide', { recursive: true });
		}
	} catch (err) {
		console.log('Pyodide package not found, proceeding with download.', err);
	}

	try {
		console.log('Loading micropip package');
		await pyodide.loadPackage('micropip');

		const micropip = pyodide.pyimport('micropip');
		console.log('Downloading Pyodide packages:', packages);

		try {
			for (const pkg of packages) {
				console.log(`Installing package: ${pkg}`);
				await micropip.install(pkg);
			}
		} catch (err) {
			console.error('Package installation failed:', err);
			return;
		}

		console.log('Pyodide packages downloaded, freezing into lock file');

		try {
			const lockFile = await micropip.freeze();
			await writeFile('static/pyodide/pyodide-lock.json', lockFile);
		} catch (err) {
			console.error('Failed to write lock file:', err);
		}
	} catch (err) {
		console.error('Failed to load or install micropip:', err);
	}
}

async function copyPyodide() {
	console.log('Copying Pyodide files into static directory');
	// Copy all files from node_modules/pyodide to static/pyodide
	for await (const entry of await readdir('node_modules/pyodide')) {
		await copyFile(`node_modules/pyodide/${entry}`, `static/pyodide/${entry}`);
	}
}

/**
 * Download pure-Python wheels from PyPI and save them into static/pyodide/.
 * Also injects entries into pyodide-lock.json so that micropip resolves these
 * packages from the local server instead of fetching them from the internet.
 */
async function downloadPyPIWheels() {
	const lockPath = 'static/pyodide/pyodide-lock.json';
	let lockData;
	try {
		lockData = JSON.parse(await readFile(lockPath, 'utf-8'));
	} catch {
		console.warn('Could not read pyodide-lock.json, skipping PyPI wheel download');
		return;
	}

	for (const pkg of pypiPackages) {
		const metadataUrls = [];
		if (useNexus) {
			metadataUrls.push(`${nexusBaseUrl.replace(/\/$/, '')}/pypi-proxy/${pkg}/json`);
		}
		metadataUrls.push(`${pypiIndexUrl}/${pkg}/json`);

		let meta = null;
		let metadataSource = null;
		for (const url of metadataUrls) {
			console.log(`Fetching package metadata: ${pkg} from ${url}`);
			const res = await fetch(url);
			if (!res.ok) {
				continue;
			}
			meta = await res.json();
			metadataSource = url;
			break;
		}

		if (!meta) {
			console.error(`Failed to fetch package metadata for ${pkg}`);
			continue;
		}

		console.log(`Using metadata source for ${pkg}: ${metadataSource}`);
		const version = meta.info.version;
		const files = meta.urls || [];
		// Find the pure-Python wheel (py3-none-any)
		const wheel = files.find(
			(f) => f.filename.endsWith('.whl') && f.filename.includes('py3-none-any')
		);
		if (!wheel) {
			console.warn(`No pure-Python wheel found for ${pkg}==${version}, skipping`);
			continue;
		}
		const dest = `static/pyodide/${wheel.filename}`;
		// Download wheel if not already present
		try {
			await access(dest);
			console.log(`  Already exists: ${wheel.filename}`);
		} catch {
			console.log(`  Downloading: ${wheel.filename}`);
			const wheelUrlCandidates = [];
			if (useNexus && metadataSource?.includes('/pypi-proxy/')) {
				wheelUrlCandidates.push(wheel.url);
			}
			wheelUrlCandidates.push(wheel.url.replace(/https:\/\/files\.pythonhosted\.org\//, `${nexusBaseUrl.replace(/\/$/, '')}/pypi-proxy/`));
			wheelUrlCandidates.push(wheel.url.replace(/https:\/\/files\.pythonhosted\.org\//, 'https://files.pythonhosted.org/'));

			let wheelRes = null;
			for (const url of wheelUrlCandidates) {
				const attempt = await fetch(url);
				if (attempt.ok) {
					wheelRes = attempt;
					break;
				}
			}

			if (!wheelRes) {
				console.error(`  Failed to download ${wheel.filename}`);
				continue;
			}
			const buffer = Buffer.from(await wheelRes.arrayBuffer());
			await writeFile(dest, buffer);
			console.log(`  Saved: ${dest} (${buffer.length} bytes)`);
		}

		// Inject into pyodide-lock.json so micropip resolves locally
		const normalizedName = pkg.replace(/-/g, '_');
		if (!lockData.packages[normalizedName]) {
			lockData.packages[normalizedName] = {
				name: normalizedName,
				version: version,
				file_name: wheel.filename,
				install_dir: 'site',
				sha256: wheel.digests?.sha256 || '',
				package_type: 'package',
				imports: [normalizedName],
				depends: []
			};
			console.log(`  Added ${normalizedName}==${version} to pyodide-lock.json`);
		}
	}

	await writeFile(lockPath, JSON.stringify(lockData, null, 2));
	console.log('Updated pyodide-lock.json with PyPI packages');
}

initNetworkProxyFromEnv();
await downloadPackages();
await copyPyodide();
await downloadPyPIWheels();
