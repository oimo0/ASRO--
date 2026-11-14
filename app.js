/* ASRO Preview - static, local-only multi-file web preview. */
(() => {
  'use strict';
  const MAX_FILES = 2000;
  const MAX_TOTAL = 150 * 1024 * 1024;
  const TEXT_LIMIT = 2 * 1024 * 1024;
  const elements = Object.fromEntries([
    'appShell','emptyView','workspace','uploadBox','pickFiles','pickFolder','fileInput','folderInput',
    'addButton','addFolderButton','replaceButton','fileList','fileCount','sidebar','toggleFiles','currentTitle',
    'entrySelect','reloadButton','fullscreenButton','previewFrame','codePreview','imageSurface','imagePreview',
    'mediaSurface','unsupportedSurface','loadingSurface','viewerStatus','emptyStatus','toast',
    'downloadButton','previewIssue','previewIssueText'
  ].map(id => [id, document.getElementById(id)]));
  const state = { files:new Map(),current:null,revision:0,busy:false,dataURLs:new Map(),token:null,objectURL:null,summary:'' };
  let toastTimeout;

  function showToast(message) {
    const el = elements.toast;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => { el.hidden = true; }, 5000);
  }
  function status(message) { elements.viewerStatus.textContent = message;elements.emptyStatus.textContent = message; }
  function formatSize(size) { return size >= 1048576 ? `${(size / 1048576).toFixed(1)} MB` : size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`; }
  function normalizePath(name) {
    if (!name || typeof name !== 'string') return null;
    const parts = name.replace(/\\/g,'/').split('/').filter(p => p && p !== '.');
    if (!parts.length || parts.some(p => p === '..' || p.includes('\0'))) return null;
    return parts.join('/');
  }
  function removeCommonFolder(entries) {
    if (!entries.length) return entries;
    const paths = entries.map(e => normalizePath(e.path)).filter(Boolean);
    if (paths.length !== entries.length) throw new Error('使用できないファイル名が含まれています。');
    const first = paths[0].split('/')[0];
    if (!paths.every(p => p.startsWith(first + '/'))) return entries.map((e,i)=>({path:paths[i],blob:e.blob}));
    return entries.map((e,i)=>({path:paths[i].slice(first.length+1),blob:e.blob}));
  }
  const PROJECT_ORIGIN = 'https://asro-preview.invalid';
  function projectURL(path) {
    return PROJECT_ORIGIN + '/' + path.split('/').map(encodeURIComponent).join('/');
  }
  function localPath(url) {
    if (url.origin !== PROJECT_ORIGIN) return null;
    try {
      const parts = url.pathname.slice(1).split('/').map(decodeURIComponent);
      if (parts.some(part => /[/\\\0]/.test(part))) return null;
      return parts.join('/');
    } catch {
      return null;
    }
  }
  function resolvePath(base, resource) {
    if (!resource || !resource.trim() || resource.trim().startsWith('#')) return null;
    try {
      const url = new URL(resource, base);
      const path = localPath(url);
      return path === null ? null : {path, hash:url.hash};
    } catch {
      return null;
    }
  }
  function isHTML(path) { return /\.(?:html?|xhtml)$/i.test(path); }
  function isImage(path) { return /\.(png|jpe?g|gif|webp|avif|bmp|svg|ico|apng)$/i.test(path); }
  function isMedia(path) { return /\.(mp4|webm|m4v|mov|mp3|wav|ogg|ogv|oga|flac|aac|m4a|opus)$/i.test(path); }
  function isText(path) { return /\.(css|js|mjs|cjs|jsx|ts|tsx|json|map|md|txt|xml|yaml|yml|vue|svelte|py|go|rs|java|kt|sh|rb|php|sql|scss|sass|less|webmanifest|csv|toml|ini|conf|gitignore|obj|mtl|gltf|wgsl|glsl|vert|frag)$/i.test(path) || /(^|\/)README$/i.test(path); }
  function fileIcon(path) {
    if(isHTML(path))return 'html'; if(/\.(jsx?|mjs|cjs|tsx?)$/i.test(path))return 'js';
    if(/\.css$/i.test(path))return 'css'; if(isImage(path))return 'image';
    if(/\.zip$/i.test(path))return 'zip'; return 'file';
  }
  function iconSvg(type) {
    const path = type === 'image' ? '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m3 17 5-5 4 4 3-3 6 6"/>'
      : type === 'html' || type === 'js' || type === 'css' ? '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v5h4"/><path d="m10 12-2 2 2 2m5-4 2 2-2 2"/>'
      : '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v5h4M9 13h6M9 17h6"/>';
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  }
  function mimeFor(path) {
    const ext=path.split('.').pop().toLowerCase();
    const types={html:'text/html',htm:'text/html',xhtml:'text/html',css:'text/css',js:'text/javascript',mjs:'text/javascript',jsx:'text/javascript',json:'application/json',map:'application/json',txt:'text/plain',md:'text/markdown',xml:'application/xml',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif',ico:'image/x-icon',bmp:'image/bmp',pdf:'application/pdf',wasm:'application/wasm',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',otf:'font/otf',mp4:'video/mp4',webm:'video/webm',mp3:'audio/mpeg',ogg:'audio/ogg',wav:'audio/wav',webmanifest:'application/manifest+json',
      gltf:'model/gltf+json',glb:'model/gltf-binary',ktx2:'image/ktx2',hdr:'image/vnd.radiance',
      apng:'image/apng',m4v:'video/mp4',mov:'video/quicktime',ogv:'video/ogg',oga:'audio/ogg',
      flac:'audio/flac',aac:'audio/aac',m4a:'audio/mp4',opus:'audio/ogg'};
    return types[ext]||'application/octet-stream';
  }
  function dataURL(project, path, transformed = null) {
    const key = transformed === null ? path : null;
    if (key !== null && project.dataURLs.has(key)) return project.dataURLs.get(key);
    const blob = new Blob([transformed ?? project.files.get(path)], {type:mimeFor(path)});
    const pending = new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    if (key !== null) project.dataURLs.set(key, pending);
    return pending;
  }
  async function assetURL(project, base, resource) {
    const target = resolvePath(base, resource);
    if (target && project.files.has(target.path)) {
      return await dataURL(project, target.path) + target.hash;
    }
    return resource;
  }
  async function replaceAsync(source,regex,replacer) {
    let out='',last=0;
    for(const match of source.matchAll(regex)) {
      out+=source.slice(last,match.index)+await replacer(match);
      last=match.index+match[0].length;
    }
    return out+source.slice(last);
  }
  async function rewriteCSS(project, css, base, ancestors = []) {
    return replaceAsync(css,
      /\/\*[\s\S]*?\*\/|@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)|"([^"]*)"|'([^']*)')|url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi,
      async match => {
        const imported = match.slice(1, 6).find(value => value !== undefined);
        if (imported !== undefined) {
          const target = resolvePath(base, imported);
          if (!target || !project.files.has(target.path)) return match[0];
          const css = ancestors.includes(target.path) ? '' : await rewriteCSS(
            project, await project.files.get(target.path).text(), projectURL(target.path), [...ancestors, target.path]
          );
          return '@import "' + await dataURL(project, target.path, css) + '"';
        }
        const resource = match[6] ?? match[7] ?? match[8];
        if (resource === undefined) return match[0];
        const url = await assetURL(project, base, resource);
        return url === resource ? match[0] : 'url("' + url + '")';
      });
  }
  function moduleKey(path) { return '@asro/' + encodeURIComponent(path); }
  function rewriteJS(code, base, project) {
    const convert = (whole, prefix, quote, specifier) => {
      if (!/^(?:\.{1,2}\/|\/)/.test(specifier)) return whole;
      const target = resolvePath(base, specifier);
      return target && project.files.has(target.path) ? prefix + quote + moduleKey(target.path) + quote : whole;
    };
    const pattern = /\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\bimport\.meta\.url\b|(\b(?:(?:import|export)\s+(?:[\w$*{},\s]+?\s+from\s*)|import\s*(?:\(\s*)?))(["'])([^"'\r\n]+)\2/g;
    return code.replace(pattern, (whole, prefix, quote, specifier) => {
      if (whole === 'import.meta.url') return JSON.stringify(base);
      return prefix ? convert(whole, prefix, quote, specifier) : whole;
    });
  }
  async function buildImportMap(project) {
    const imports = Object.create(null);
    for (const [path, blob] of project.files) {
      if (!/\.(?:js|mjs|json)$/i.test(path)) continue;
      let source = null;
      if (!/\.json$/i.test(path)) {
        const original = await blob.text();
        const edited = rewriteJS(original, projectURL(path), project);
        if (edited !== original) source = edited;
      }
      imports[moduleKey(path)] = await dataURL(project, path, source);
    }
    const packages = [
      ['three', 'node_modules/three/build/three.module.js'],
      ['@babylonjs/core', 'node_modules/@babylonjs/core/index.js'],
      ['@babylonjs/loaders', 'node_modules/@babylonjs/loaders/index.js']
    ];
    for (const [name, path] of packages) {
      if (imports[moduleKey(path)]) imports[name] = imports[moduleKey(path)];
    }
    for (const path of project.files.keys()) {
      const prefix = 'node_modules/three/examples/jsm/';
      if (path.startsWith(prefix) && imports[moduleKey(path)]) {
        imports['three/addons/' + path.slice(prefix.length)] = imports[moduleKey(path)];
        imports['three/examples/jsm/' + path.slice(prefix.length)] = imports[moduleKey(path)];
      }
    }
    return imports;
  }
  function scriptJSON(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c');
  }
  function installPreviewBridge(token, base, projectOrigin, paths) {
    const available = new Set(paths);
    const pending = new Map();
    let counter = 0;
    const send = (kind, details) => parent.postMessage({asroPreview:true, token, kind, ...details}, '*');
    const nativeFetch = window.fetch.bind(window);
    async function fetchAsset(resource, options) {
      const input = resource instanceof Request ? resource.url : String(resource);
      const url = new URL(input, base);
      if (url.origin !== projectOrigin) {
        return nativeFetch(resource instanceof Request ? resource : url.href, options);
      }
      const path = localPath(url);
      const method = (options?.method ?? (resource instanceof Request ? resource.method : 'GET')).toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') return new Response(null, {status:405});
      if (!available.has(path)) {
        send('issue', {message:'関連ファイルが見つかりません: ' + url.pathname});
        return new Response(null, {status:404});
      }
      const signal = options?.signal ?? (resource instanceof Request ? resource.signal : null);
      if (signal?.aborted) throw signal.reason;
      const message = await new Promise((resolve, reject) => {
        const id = ++counter;
        const abort = () => {
          pending.delete(id);
          reject(signal.reason);
        };
        signal?.addEventListener('abort', abort, {once:true});
        pending.set(id, value => {
          signal?.removeEventListener('abort', abort);
          resolve(value);
        });
        send('fetch', {id, path, head:method === 'HEAD'});
      });
      if (message.error) throw new TypeError(message.error);
      const response = new Response(message.bytes ?? null, {
        headers:{'Content-Type':message.mime, 'Content-Length':String(message.size)}
      });
      Object.defineProperty(response, 'url', {value:url.href});
      return response;
    }
    window.fetch = fetchAsset;
    window.addEventListener('message', event => {
      const msg = event.data;
      if (event.source !== parent || !msg?.asroPreview || msg.token !== token || msg.kind !== 'fetch-result') return;
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    });
    // Image loaders commonly assign to image.src instead of using fetch.
    const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    const imageRequests = new WeakMap();
    const imageAssets = new Map();
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...src,
      set(input) {
        const target = resolvePath(base, String(input));
        if (!target || !available.has(target.path)) {
          imageRequests.delete(this);
          src.set.call(this, input);
          return;
        }
        const original = this.getAttribute('src');
        imageRequests.set(this, target);
        if (!imageAssets.has(target.path)) {
          const fileURL = new URL(String(input), base);
          fileURL.hash = '';
          const asset = fetchAsset(fileURL).then(async response => {
            return URL.createObjectURL(await response.blob());
          });
          imageAssets.set(target.path, asset);
          asset.catch(() => imageAssets.delete(target.path));
        }
        imageAssets.get(target.path).then(url => {
          if (imageRequests.get(this) !== target || this.getAttribute('src') !== original) return;
          src.set.call(this, url + target.hash);
        }, () => {
          if (imageRequests.get(this) === target) {
            send('issue', {message:'画像の読み込みに失敗: ' + target.path});
          }
        });
      }
    });
    window.addEventListener('error', event => {
      const element = event.target;
      const resource = element?.getAttribute?.('src') ?? element?.getAttribute?.('href');
      if (event.message || resource) {
        send('issue', {message:event.message || (/^data:/i.test(resource)
          ? '埋め込んだ素材を読み込めませんでした。'
          : '素材の読み込みに失敗: ' + resource.slice(0, 160))});
      }
    }, true);
    window.addEventListener('unhandledrejection', event => {
      send('issue', {message:String(event.reason?.message ?? event.reason ?? 'JavaScript エラー')});
    });
    document.addEventListener('click', event => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest?.('a[href]');
      const href = link?.getAttribute('href');
      if (!href || link.hasAttribute('download')) return;
      if (href.startsWith('#')) {
        event.preventDefault();
        if (href === '#') window.scrollTo(0, 0);
        else scrollToAnchor(href);
        return;
      }
      const target = resolvePath(base, href);
      if (!target) return;
      if (!available.has(target.path)) target.path = target.path.replace(/\/?$/, '/') + 'index.html';
      target.path = target.path.replace(/^\//, '');
      if (available.has(target.path) && /\.(?:html?|xhtml)$/i.test(target.path)) {
        event.preventDefault();
        send('open', target);
      }
    });
  }
  function scrollToAnchor(hash) {
    let id = hash.slice(1);
    try { id = decodeURIComponent(id); } catch { /* Use the literal fragment. */ }
    (document.getElementById(id) ?? document.getElementsByName(id)[0])?.scrollIntoView();
  }

  async function buildHTML(path, project, token, hash) {
    const source = await project.files.get(path).text();
    const doc = new DOMParser().parseFromString(source, 'text/html');
    const entryURL = projectURL(path);
    const baseElement = doc.querySelector('base[href]');
    let base = entryURL;
    if (baseElement) {
      try { base = new URL(baseElement.getAttribute('href'), entryURL).href; }
      catch { /* Use the entry URL for invalid base elements. */ }
    }
    for (const element of doc.querySelectorAll('base[href]')) element.removeAttribute('href');
    const documentBase = baseElement ?? doc.createElement('base');
    documentBase.href = base;
    doc.head.prepend(documentBase);
    for (const refresh of doc.querySelectorAll('meta[http-equiv="refresh" i]')) refresh.remove();

    const scripts = [...doc.querySelectorAll('script')];
    const hasModules = scripts.some(script => /^(?:module|importmap)$/i.test(script.type)) ||
      [...project.files.keys()].some(name => /\.(?:js|mjs)$/i.test(name));
    const imports = hasModules ? await buildImportMap(project) : {};
    const mapped = Object.keys(imports).length > 0;
    const resolveImport = value => {
      if (typeof value !== 'string') return value;
      const target = resolvePath(base, value);
      return target ? (imports[moduleKey(target.path)] ?? value) : value;
    };
    const maps = scripts.filter(script => script.type.toLowerCase() === 'importmap' && !script.src);
    for (const [index, map] of maps.entries()) {
      try {
        const config = JSON.parse(map.textContent);
        for (const imports of [config.imports, ...Object.values(config.scopes ?? {})]) {
          if (!imports || typeof imports !== 'object') continue;
          for (const name of Object.keys(imports)) imports[name] = resolveImport(imports[name]);
        }
        if (index === 0 && mapped) config.imports = {...imports, ...config.imports};
        map.textContent = scriptJSON(config);
      } catch { /* Let the browser report invalid import maps. */ }
    }
    if (mapped && !maps.length) {
      const map = doc.createElement('script');
      map.type = 'importmap';
      map.textContent = scriptJSON({imports});
      documentBase.after(map);
    }
    for (const script of scripts) {
      const src = script.getAttribute('src');
      const type = script.type.trim().toLowerCase();
      const isModule = type === 'module';
      const isJavaScript = isModule || !type || /^(?:text|application)\/(?:x-)?(?:javascript|ecmascript)$/.test(type);
      if (!isJavaScript) continue;
      if (src) {
        const target = resolvePath(base, src);
        if (target && project.files.has(target.path)) {
          if (isModule && imports[moduleKey(target.path)]) {
            script.src = imports[moduleKey(target.path)];
            script.removeAttribute('integrity');
          } else {
            const blob = project.files.get(target.path);
            const code = await blob.text();
            const edited = rewriteJS(code, projectURL(target.path), project);
            script.src = await dataURL(project, target.path, edited === code ? null : edited);
            if (edited !== code) script.removeAttribute('integrity');
          }
        }
      } else if (isModule || mapped) {
        script.textContent = rewriteJS(script.textContent, base, project);
      }
    }
    for (const link of doc.querySelectorAll('link[href]')) {
      const raw = link.getAttribute('href');
      const target = resolvePath(base, raw);
      if (!target || !project.files.has(target.path)) continue;
      if (link.relList.contains('stylesheet')) {
        const blob = project.files.get(target.path);
        const css = await rewriteCSS(project, await blob.text(), projectURL(target.path), [target.path]);
        link.href = await dataURL(project, target.path, css);
        link.removeAttribute('integrity');
      } else if (link.relList.contains('modulepreload') && imports[moduleKey(target.path)]) {
        link.href = imports[moduleKey(target.path)];
        link.removeAttribute('integrity');
      } else {
        link.href = await assetURL(project, base, raw);
      }
    }
    for (const style of doc.querySelectorAll('style')) {
      style.textContent = await rewriteCSS(project, style.textContent, base);
    }
    for (const node of doc.querySelectorAll('[style], [src], [poster], svg [href], svg [xlink\\:href]')) {
      if (node.hasAttribute('style')) {
        node.setAttribute('style', await rewriteCSS(project, node.getAttribute('style'), base));
      }
      if (node.localName === 'script') continue;
      const attrs = node.namespaceURI === 'http://www.w3.org/2000/svg'
        ? ['href', 'xlink:href'] : ['src', 'poster'];
      for (const attr of attrs) {
        if (!node.hasAttribute(attr)) continue;
        node.setAttribute(attr, await assetURL(project, base, node.getAttribute(attr)));
      }
    }
    for (const node of doc.querySelectorAll('[srcset]')) {
      const srcset = node.getAttribute('srcset');
      const rewritten = await replaceAsync(srcset, /(?:^|,)\s*(data:[^\s]+|[^\s,]+)(?:\s+[^,]+)?/gi, async match => {
        const [candidate, url] = match;
        if (/^data:/i.test(url)) return candidate;
        const offset = candidate.indexOf(url);
        return candidate.slice(0, offset) + await assetURL(project, base, url) + candidate.slice(offset + url.length);
      });
      node.setAttribute('srcset', rewritten);
    }
    const shim = doc.createElement('script');
    shim.textContent = '(function(){const PROJECT_ORIGIN=' + scriptJSON(PROJECT_ORIGIN) + ';' +
      localPath.toString() + ';' + resolvePath.toString() + ';' + scrollToAnchor.toString() + ';(' + installPreviewBridge.toString() +
      ')(' + [token, base, PROJECT_ORIGIN, [...project.files.keys()]].map(scriptJSON).join(',') + ');' +
      (hash.startsWith('#') ? 'addEventListener("load",()=>scrollToAnchor(' + scriptJSON(hash) + '));' : '') + '})();';
    doc.head.prepend(shim);
    const doctype = doc.doctype ? new XMLSerializer().serializeToString(doc.doctype) + '\n' : '';
    return doctype + doc.documentElement.outerHTML;
  }
  function releaseObjectURL() {if(state.objectURL){URL.revokeObjectURL(state.objectURL);state.objectURL=null;}}
  function randomToken() {
    const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);
    return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  async function readDirectory(entry,base,output,depth=0) {
    if(depth>18)throw new Error('フォルダ階層が深すぎます。');
    if(entry.isFile) {
      const file=await new Promise((resolve,reject)=>entry.file(resolve,reject));
      output.push({path:base+file.name,blob:file});
      if(output.length>MAX_FILES)throw new Error('ファイルは最大2,000個までです。');
      return;
    }
    if(entry.isDirectory) {
      const reader=entry.createReader();const children=[];
      while(true){const batch=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));if(!batch.length)break;children.push(...batch);if(children.length>MAX_FILES)throw new Error('ファイルが多すぎます。');}
      for(const child of children)await readDirectory(child,base+entry.name+'/',output,depth+1);
    }
  }
  async function fromDrop(event) {
    const dt=event.dataTransfer;
    if(dt.items && [...dt.items].some(item=>item.kind==='file' && typeof item.webkitGetAsEntry==='function')) {
      const entries=[...dt.items].filter(x=>x.kind==='file').map(x=>x.webkitGetAsEntry()).filter(Boolean);
      if(entries.length) {const out=[];for(const entry of entries)await readDirectory(entry,'',out);return out;}
    }
    return [...dt.files].map(f=>({path:f.webkitRelativePath||f.name,blob:f}));
  }
  async function processFileInput(input) {
    const files=[...input.files].map(f=>({path:f.webkitRelativePath||f.name,blob:f}));
    input.value='';
    await importEntries(files);
  }
  async function importEntries(raw) {
    if(state.busy)return;
    state.busy=true;
    const initialFiles=state.files;
    status('ファイルを準備中...');
    try {
      if(!raw.length)throw new Error('ファイルが見つかりませんでした。');
      const loose = [];
      const incoming = [];
      for(const item of raw) {
        if(/\.zip$/i.test(item.path)){
          const unpacked=await window.ASROZip.unpackZip(item.blob);
          incoming.push(...removeCommonFolder(unpacked));
        } else loose.push(item);
        if(incoming.length + loose.length > MAX_FILES)throw new Error('ファイルは最大2,000個までです。');
      }
      incoming.push(...removeCommonFolder(loose));
      const next=new Map(state.files);
      for(const item of incoming) {
        const path=normalizePath(item.path);
        if(!path)throw new Error('安全でないファイル名が含まれています。');
        next.set(path,item.blob);
      }
      if(next.size>MAX_FILES)throw new Error('ファイルは最大2,000個までです。');
      const total=[...next.values()].reduce((sum,blob)=>sum+blob.size,0);
      if(total>MAX_TOTAL)throw new Error('ファイルの合計は150MB以下にしてね。');
      if (state.files !== initialFiles) return;
      const oldCurrent=state.current;
      state.files=next;
      state.dataURLs=new Map();
      state.summary=`${next.size} ファイル · ${formatSize(total)} · ローカルのみ`;
      const htmlFiles=[...next.keys()].filter(isHTML).sort((a,b)=>a.length-b.length || a.localeCompare(b));
      const selection=oldCurrent && next.has(oldCurrent) ? oldCurrent : htmlFiles.find(f=>f.toLowerCase()==='index.html') || htmlFiles.find(f=>f.split('/').pop().toLowerCase()==='index.html') || htmlFiles[0] || [...next.keys()][0];
      elements.emptyView.hidden=true;elements.workspace.hidden=false;elements.addButton.hidden=false;
      renderFiles();
      await selectFile(selection);
    } catch(error) {
      showToast(error?.message || 'ファイルを読み込めませんでした。');
      status('読み込みに失敗しました');
      console.error('ASRO Preview:',error);
    } finally {state.busy=false;}
  }
  function renderFiles() {
    const filePaths=[...state.files.keys()].sort((a,b)=>a.localeCompare(b));
    elements.fileCount.textContent=String(filePaths.length);
    elements.fileList.replaceChildren();
    const fragment=document.createDocumentFragment();
    for(const path of filePaths) {
      const button=document.createElement('button');button.type='button';button.className='file-item'+(state.current===path?' selected':'');
      button.title=path;button.setAttribute('role','listitem');button.setAttribute('aria-label',path);
      button.innerHTML=iconSvg(fileIcon(path));
      const span=document.createElement('span');span.textContent=path;
      button.append(span);button.addEventListener('click',()=>{selectFile(path);closeSidebar();});fragment.append(button);
    }
    elements.fileList.append(fragment);
    const html=[...state.files.keys()].filter(isHTML).sort((a,b)=>a.length-b.length || a.localeCompare(b));
    elements.entrySelect.replaceChildren();
    if(html.length)for(const path of html){const option=document.createElement('option');option.value=path;option.textContent=path;elements.entrySelect.append(option);}
    else {const option=document.createElement('option');option.textContent='HTMLなし';option.value='';elements.entrySelect.append(option);}
    elements.entrySelect.disabled=!html.length;
  }
  function hideSurfaces() {
    for(const el of [elements.previewFrame,elements.codePreview,elements.imageSurface,elements.mediaSurface,elements.unsupportedSurface,elements.loadingSurface])el.hidden=true;
    elements.mediaSurface.replaceChildren();
    elements.previewFrame.srcdoc='';
    elements.imagePreview.removeAttribute('src');
    elements.previewIssue.hidden = true;
    elements.previewIssue.open = false;
    releaseObjectURL();
  }
  function reportIssue(message) {
    if (!elements.previewIssue.hidden) return;
    elements.previewIssueText.textContent = message.slice(0, 300);
    elements.previewIssue.hidden = false;
  }
  async function selectFile(path, hash = '') {
    if(!state.files.has(path))return;
    state.current=path;
    state.revision++;
    const rev=state.revision;
    const token=randomToken();
    state.token=token;
    const blob=state.files.get(path);
    elements.currentTitle.textContent=path.split('/').pop();elements.currentTitle.title=path;
    elements.entrySelect.value=isHTML(path)?path:'';
    for(const button of elements.fileList.querySelectorAll('.file-item'))button.classList.toggle('selected',button.title===path);
    hideSurfaces();
    status(state.summary);
    if(isHTML(path)) {
      elements.loadingSurface.hidden=false;
      try {
        const html=await buildHTML(path, {files:state.files, dataURLs:state.dataURLs}, token, hash);
        if(rev!==state.revision)return;
        elements.loadingSurface.hidden=true;
        elements.previewFrame.hidden=false;
        elements.previewFrame.srcdoc=html;
      } catch(error) {
        if(rev!==state.revision)return;
        elements.loadingSurface.hidden=true;elements.unsupportedSurface.hidden=false;
        elements.unsupportedSurface.textContent='プレビューを準備できませんでした。';
        reportIssue(error?.message || 'HTML を読み込めませんでした。');
      }
    } else if(isImage(path)) {
      state.objectURL=URL.createObjectURL(new Blob([blob],{type:mimeFor(path)}));
      elements.imageSurface.hidden=false;
      elements.imagePreview.src=state.objectURL;
      elements.imagePreview.alt=path;
    } else if(isMedia(path)) {
      state.objectURL=URL.createObjectURL(new Blob([blob],{type:mimeFor(path)}));
      elements.mediaSurface.hidden=false;
      const video=/\.(mp4|webm|m4v|mov|ogv)$/i.test(path);
      const media=document.createElement(video?'video':'audio');
      media.controls=true;media.preload='metadata';media.src=state.objectURL;
      media.addEventListener('error', () => {
        if (rev === state.revision) reportIssue('このブラウザで再生できる形式か確認してください。');
      }, {once:true});
      elements.mediaSurface.append(media);
    } else if(isText(path)) {
      elements.codePreview.hidden=false;
      if(blob.size>TEXT_LIMIT)elements.codePreview.querySelector('code').textContent='ファイルが大きいため、テキスト表示を省略しました。';
      else {
        const content=await blob.text();
        if(rev!==state.revision)return;
        elements.codePreview.querySelector('code').textContent=content;
      }
    } else {
      elements.unsupportedSurface.textContent = 'この形式のファイルはダウンロードして開けます。';
      elements.unsupportedSurface.hidden=false;
    }
  }
  function closeSidebar(){elements.sidebar.classList.remove('open');elements.toggleFiles.setAttribute('aria-expanded','false');}
  async function resetProject() {
    hideSurfaces();
    state.files=new Map();state.dataURLs=new Map();state.token=null;state.current=null;state.revision++;
    elements.workspace.hidden=true;elements.emptyView.hidden=false;elements.addButton.hidden=true;
    closeSidebar();status('ログイン不要・ブラウザだけで完結');
  }
  elements.pickFiles.addEventListener('click',()=>elements.fileInput.click());
  elements.pickFolder.addEventListener('click',()=>elements.folderInput.click());
  elements.addButton.addEventListener('click',()=>elements.fileInput.click());
  elements.replaceButton.addEventListener('click',resetProject);
  elements.addFolderButton.addEventListener('click',()=>elements.folderInput.click());
  elements.fileInput.addEventListener('change',()=>processFileInput(elements.fileInput));
  elements.folderInput.addEventListener('change',()=>processFileInput(elements.folderInput));
  elements.entrySelect.addEventListener('change',()=>{const path=elements.entrySelect.value;if(path)selectFile(path);});
  elements.reloadButton.addEventListener('click',()=>{if(state.current)selectFile(state.current);});
  elements.downloadButton.addEventListener('click', () => {
    const blob = state.files.get(state.current);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = state.current.split('/').pop();
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });
  elements.fullscreenButton.addEventListener('click', async()=>{
    try {
      if(document.fullscreenElement) await document.exitFullscreen();
      else if(!elements.previewFrame.hidden) await elements.previewFrame.requestFullscreen();
      else await document.getElementById('renderSurface').requestFullscreen();
    } catch(error) { showToast('このブラウザでは全画面表示を利用できません。'); }
  });
  elements.toggleFiles.addEventListener('click',()=>{const open=!elements.sidebar.classList.contains('open');elements.sidebar.classList.toggle('open',open);elements.toggleFiles.setAttribute('aria-expanded',String(open));});
  elements.uploadBox.addEventListener('click',event=>{if(event.target.closest('button'))return;elements.fileInput.click();});
  elements.uploadBox.addEventListener('keydown',event=>{if(event.target!==elements.uploadBox)return;if(event.key==='Enter'||event.key===' '){event.preventDefault();elements.fileInput.click();}});
  document.addEventListener('dragenter',e=>{if(e.dataTransfer?.types?.includes('Files')){e.preventDefault();elements.appShell.classList.add('drag-over');}});
  document.addEventListener('dragover',e=>{if(e.dataTransfer?.types?.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
  document.addEventListener('dragleave',e=>{if(!e.relatedTarget||!document.documentElement.contains(e.relatedTarget))elements.appShell.classList.remove('drag-over');});
  document.addEventListener('drop',async e=>{e.preventDefault();elements.appShell.classList.remove('drag-over');if(!e.dataTransfer?.files.length)return;try{await importEntries(await fromDrop(e));}catch(err){showToast(err?.message||'読み込みに失敗しました。');}});
  // The preview uses an opaque-origin iframe, with no Service Worker or server.
  window.addEventListener('message',async(event)=>{
    if(event.source!==elements.previewFrame.contentWindow || elements.previewFrame.hidden)return;
    const msg=event.data;
    if(!msg||!msg.asroPreview||msg.token!==state.token)return;
    if(msg.kind==='open'){
      if(state.files.has(msg.path)&&isHTML(msg.path))selectFile(msg.path, typeof msg.hash === 'string' ? msg.hash : '');
      return;
    }
    if(msg.kind === 'issue' && typeof msg.message === 'string') {
      reportIssue(msg.message);
      return;
    }
    if(msg.kind!=='fetch'||!Number.isInteger(msg.id))return;
    const target=state.files.get(msg.path);
    if(!target)return;
    const token=state.token;
    const frame=elements.previewFrame.contentWindow;
    try{
      const bytes=msg.head === true ? null : await target.arrayBuffer();
      if(token!==state.token||frame!==elements.previewFrame.contentWindow)return;
      frame.postMessage({asroPreview:true,token,kind:'fetch-result',id:msg.id,mime:mimeFor(msg.path),size:target.size,bytes},'*',bytes ? [bytes] : []);
    }catch(error){
      frame.postMessage({asroPreview:true,token,kind:'fetch-result',id:msg.id,error:'ファイルを読み込めませんでした'},'*');
    }
  });
})();
