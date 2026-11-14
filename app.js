/* ASRO Preview - static, local-only multi-file web preview. */
(() => {
  'use strict';
    const MAX_FILES = 2000;
  const MAX_TOTAL = 150 * 1024 * 1024;
  const TEXT_LIMIT = 2 * 1024 * 1024;
    const elements = Object.fromEntries([
    'appShell','emptyView','workspace','uploadBox','pickFiles','pickFolder','fileInput','folderInput',
    'addButton','addFolderButton','replaceButton','fileList','fileCount','sidebar','toggleFiles','currentTitle',
    'entrySelect','reloadButton','previewFrame','codePreview','imageSurface','imagePreview',
    'mediaSurface','unsupportedSurface','loadingSurface','viewerStatus','emptyStatus','toast'
  ].map(id => [id, document.getElementById(id)]));
  const state = { files:new Map(),current:null,revision:0,busy:false,dataURLs:new Map(),token:null,objectURL:null };
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
  function isHTML(path) { return /\.html?$/i.test(path); }
  function isImage(path) { return /\.(png|jpe?g|gif|webp|avif|bmp|svg|ico)$/i.test(path); }
  function isMedia(path) { return /\.(mp4|webm|mp3|wav|ogg)$/i.test(path); }
  function isText(path) { return /\.(css|js|mjs|cjs|jsx|ts|tsx|json|map|md|txt|xml|yaml|yml|vue|svelte|py|go|rs|java|kt|sh|rb|php|sql|scss|sass|less|webmanifest|csv|toml|ini|conf|gitignore|svg)$/i.test(path) || /(^|\/)README$/i.test(path); }
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
    const types={html:'text/html',htm:'text/html',css:'text/css',js:'text/javascript',mjs:'text/javascript',jsx:'text/javascript',json:'application/json',map:'application/json',txt:'text/plain',md:'text/markdown',xml:'application/xml',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif',ico:'image/x-icon',bmp:'image/bmp',pdf:'application/pdf',wasm:'application/wasm',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',otf:'font/otf',mp4:'video/mp4',webm:'video/webm',mp3:'audio/mpeg',ogg:'audio/ogg',wav:'audio/wav',webmanifest:'application/manifest+json'};
    return types[ext]||'application/octet-stream';
  }
  function resolvePath(from,resource) {
    if(!resource || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(resource)) return null;
    const clean=resource.split(/[?#]/,1)[0].replace(/\\/g,'/');
    const parts=clean.startsWith('/') ? [] : from.split('/').slice(0,-1);
    for(const part of clean.split('/')){
      if(!part || part==='.')continue;
      if(part==='..'){if(!parts.length)return null;parts.pop();}
      else parts.push(part);
    }
    return parts.join('/');
  }
  async function dataURL(path,asText=null) {
    if(!state.files.has(path))return null;
    const key=path+'|'+(asText??'');
    if(state.dataURLs.has(key))return state.dataURLs.get(key);
    const blob=state.files.get(path);
    const src=asText===null ? blob : new Blob([asText],{type:mimeFor(path)});
    const typed=asText===null ? new Blob([src],{type:mimeFor(path)}) : src;
    const result=await new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);
      reader.readAsDataURL(typed);
    });
    state.dataURLs.set(key,result);
    return result;
  }
  async function replaceAsync(source,regex,replacer) {
    let out='',last=0;
    for(const match of source.matchAll(regex)) {
      out+=source.slice(last,match.index)+await replacer(match);
      last=match.index+match[0].length;
    }
    return out+source.slice(last);
  }
  async function cssContent(path,visited=new Set()) {
    if(visited.has(path))return '';
    const next=new Set(visited);next.add(path);
    let css=await state.files.get(path).text();
    css=await replaceAsync(css,/@import\s+(?:url\(\s*)?(["'])([^"']+)\1\s*\)?/gi,async m=>{
      const target=resolvePath(path,m[2]);
      if(!target || !state.files.has(target) || !/\.css$/i.test(target))return m[0];
      const imported=await cssContent(target,next);
      return m[0].replace(m[2],await dataURL(target,imported));
    });
    css=await replaceAsync(css,/url\(\s*(["']?)([^)"']+)\1\s*\)/gi,async m=>{
      const target=resolvePath(path,m[2].trim());
      if(!target || !state.files.has(target))return m[0];
      return `url("${await dataURL(target)}")`;
    });
    return css;
  }
  function moduleKey(path){return '@asro/'+encodeURIComponent(path);}
  function rewriteJS(code,path) {
    const convert=(_,prefix,quote,spec)=>{
      const target=resolvePath(path,spec);
      return prefix+quote+(target && state.files.has(target) ? moduleKey(target) : spec)+quote;
    };
    return code
      .replace(/(\b(?:import|export)\s+(?:[^;]*?\s+from\s*))(["'])([^"']+)\2/g,convert)
      .replace(/(\bimport\s*)(["'])([^"']+)\2/g,convert)
      .replace(/(\bimport\s*\(\s*)(["'])([^"']+)\2/g,convert);
  }
  async function buildImportMap() {
    const imports={};
    for(const path of state.files.keys()) {
      if(!/\.(?:js|mjs)$/i.test(path))continue;
      const blob=state.files.get(path);
      if(blob.size>8*1024*1024)throw new Error('JavaScriptファイルは1つ8MB以下にしてね。');
      imports[moduleKey(path)]=await dataURL(path,rewriteJS(await blob.text(),path));
    }
    return imports;
  }
  function bridgeSource(token,entry) {
    // The iframe has an opaque origin and receives *only* requested local files.
    return `(function(){'use strict';
      const token=${JSON.stringify(token)},entry=${JSON.stringify(entry)};
      const paths=new Set(${JSON.stringify([...state.files.keys()])});
      const pending=new Map();let counter=0;
      function relative(input){
        if(!input||/^(?:[a-z][a-z0-9+.-]*:|\\/\\/|#)/i.test(input))return null;
        const s=input.split(/[?#]/,1)[0].replace(/\\\\/g,'/');
        const arr=s.startsWith('/')?[]:entry.split('/').slice(0,-1);
        for(const part of s.split('/')){if(!part||part==='.')continue;if(part==='..'){if(!arr.length)return null;arr.pop();}else arr.push(part);}
        return arr.join('/');
      }
      const nativeFetch=window.fetch.bind(window);
      window.fetch=function(resource,options){
        const input=typeof resource==='string'?resource:(resource instanceof URL?resource.href:resource?.url);
        const path=relative(input);
        if(!path||!paths.has(path))return nativeFetch(resource,options);
        return new Promise((resolve,reject)=>{
          const id=++counter;pending.set(id,{resolve,reject});
          parent.postMessage({asroPreview:true,token,kind:'fetch',id,path},'*');
        }).then(message=>new Response(message.bytes,{status:message.status,headers:{'Content-Type':message.mime}}));
      };
      window.addEventListener('message',event=>{
        if(event.source!==parent)return;
        const m=event.data;
        if(!m||!m.asroPreview||m.token!==token||m.kind!=='fetch-result')return;
        const entry=pending.get(m.id);if(!entry)return;pending.delete(m.id);
        if(m.error)entry.reject(new Error(m.error));else entry.resolve(m);
      });
      document.addEventListener('click',event=>{
        const a=event.target.closest?.('a[href]');if(!a)return;
        const target=relative(a.getAttribute('href'));
        if(target&&paths.has(target)&&/\\.html?$/i.test(target)){
          event.preventDefault();parent.postMessage({asroPreview:true,token,kind:'open',path:target},'*');
        }
      });
    })();`;
  }
  async function buildHTML(path) {
    const source=await state.files.get(path).text();
    const doc=new DOMParser().parseFromString(source,'text/html');
    for(const base of doc.querySelectorAll('base'))base.remove();
    for(const refresh of doc.querySelectorAll('meta[http-equiv="refresh" i]'))refresh.remove();
    const imports=await buildImportMap();
    for(const script of doc.querySelectorAll('script')) {
      const src=script.getAttribute('src');
      const isModule=script.getAttribute('type')?.toLowerCase()==='module';
      if(src) {
        const target=resolvePath(path,src);
        if(target && state.files.has(target)) {
          script.setAttribute('src',isModule&&imports[moduleKey(target)] ? imports[moduleKey(target)] : await dataURL(target));
        }
      }else if(isModule)script.textContent=rewriteJS(script.textContent,path);
    }
    for(const link of doc.querySelectorAll('link[href]')) {
      const url=link.getAttribute('href');const target=resolvePath(path,url);
      if(!target||!state.files.has(target))continue;
      const rel=link.rel?.toLowerCase()||'';
      if(rel.includes('stylesheet')&&/\.css$/i.test(target))link.href=await dataURL(target,await cssContent(target));
      else link.href=await dataURL(target);
    }
    for(const style of doc.querySelectorAll('style')) {
      let css=style.textContent;
      css=await replaceAsync(css,/url\(\s*(["']?)([^)"']+)\1\s*\)/gi,async m=>{
        const target=resolvePath(path,m[2].trim());
        return target&&state.files.has(target)?`url("${await dataURL(target)}")`:m[0];
      });
      style.textContent=css;
    }
    for(const el of doc.querySelectorAll('[src], [poster]')) {
      if(el.tagName==='SCRIPT')continue;
      for(const attr of ['src','poster']){
        const raw=el.getAttribute(attr);const target=resolvePath(path,raw);
        if(target&&state.files.has(target))el.setAttribute(attr,await dataURL(target));
      }
    }
    for(const el of doc.querySelectorAll('[srcset]')) {
      const srcset=el.getAttribute('srcset');
      const components=srcset.split(',');
      const rewritten=[];
      for(const part of components){
        const match=part.trim().match(/^(\S+)(\s+.*)?$/);if(!match){rewritten.push(part);continue;}
        const target=resolvePath(path,match[1]);
        rewritten.push(target&&state.files.has(target)?`${await dataURL(target)}${match[2]||''}`:part);
      }
      el.setAttribute('srcset',rewritten.join(', '));
    }
    const importEl=doc.createElement('script');importEl.type='importmap';importEl.textContent=JSON.stringify({imports}).replace(/</g,'\\u003c');
    doc.head.insertBefore(importEl,doc.head.firstChild);
    const shim=doc.createElement('script');shim.textContent=bridgeSource(state.token,path);
    doc.head.insertBefore(shim,importEl.nextSibling);
    return '<!doctype html>\n'+doc.documentElement.outerHTML;
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
    status('ファイルを準備中...');
    try {
      if(!raw.length)throw new Error('ファイルが見つかりませんでした。');
      let incoming=[];
      for(const item of raw) {
        if(/\.zip$/i.test(item.path)){
          const unpacked=await window.ASROZip.unpackZip(item.blob);
          incoming.push(...removeCommonFolder(unpacked));
        }else incoming.push(item);
        if(incoming.length>MAX_FILES)throw new Error('ファイルは最大2,000個までです。');
      }
      incoming=removeCommonFolder(incoming);
      const next=new Map(state.files);
      for(const item of incoming) {
        const path=normalizePath(item.path);
        if(!path)throw new Error('安全でないファイル名が含まれています。');
        next.set(path,item.blob);
      }
      if(next.size>MAX_FILES)throw new Error('ファイルは最大2,000個までです。');
      const total=[...next.values()].reduce((sum,blob)=>sum+blob.size,0);
      if(total>MAX_TOTAL)throw new Error('ファイルの合計は150MB以下にしてね。');
      const oldCurrent=state.current;
      state.files=next;
      state.dataURLs.clear();
      state.token=randomToken();
      const htmlFiles=[...next.keys()].filter(isHTML).sort((a,b)=>a.length-b.length || a.localeCompare(b));
      const selection=oldCurrent && next.has(oldCurrent) ? oldCurrent : htmlFiles.find(f=>f.toLowerCase()==='index.html') || htmlFiles.find(f=>f.split('/').pop().toLowerCase()==='index.html') || htmlFiles[0] || [...next.keys()][0];
      elements.emptyView.hidden=true;elements.workspace.hidden=false;elements.addButton.hidden=false;
      renderFiles();
      await selectFile(selection);
      status(`${next.size} ファイル · ${formatSize(total)} · ローカルのみ`);
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
    releaseObjectURL();
  }
  async function selectFile(path) {
    if(!state.files.has(path))return;
    state.current=path;
    state.revision++;
    const rev=state.revision;
    const blob=state.files.get(path);
    elements.currentTitle.textContent=path.split('/').pop();elements.currentTitle.title=path;
    elements.entrySelect.value=isHTML(path)?path:'';
    for(const button of elements.fileList.querySelectorAll('.file-item'))button.classList.toggle('selected',button.title===path);
    hideSurfaces();
    if(isHTML(path)) {
      elements.loadingSurface.hidden=false;
      try {
        const html=await buildHTML(path);
        if(rev!==state.revision)return;
        elements.loadingSurface.hidden=true;
        elements.previewFrame.hidden=false;
        elements.previewFrame.srcdoc=html;
      } catch(error) {
        if(rev!==state.revision)return;
        elements.loadingSurface.hidden=true;elements.unsupportedSurface.hidden=false;
        elements.unsupportedSurface.textContent=error?.message || 'プレビューを生成できませんでした。';
      }
    } else if(isImage(path)) {
      state.objectURL=URL.createObjectURL(new Blob([blob],{type:mimeFor(path)}));
      elements.imageSurface.hidden=false;
      elements.imagePreview.src=state.objectURL;
      elements.imagePreview.alt=path;
    } else if(isMedia(path)) {
      state.objectURL=URL.createObjectURL(new Blob([blob],{type:mimeFor(path)}));
      elements.mediaSurface.hidden=false;
      const video=/\.(mp4|webm)$/i.test(path);
      const media=document.createElement(video?'video':'audio');
      media.controls=true;media.preload='metadata';media.src=state.objectURL;
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
      elements.unsupportedSurface.hidden=false;
    }
  }
  function closeSidebar(){elements.sidebar.classList.remove('open');elements.toggleFiles.setAttribute('aria-expanded','false');}
  async function resetProject() {
    elements.previewFrame.src='about:blank';
    state.files.clear();state.dataURLs.clear();state.token=null;state.current=null;state.revision++;releaseObjectURL();
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
  elements.toggleFiles.addEventListener('click',()=>{const open=!elements.sidebar.classList.contains('open');elements.sidebar.classList.toggle('open',open);elements.toggleFiles.setAttribute('aria-expanded',String(open));});
  elements.uploadBox.addEventListener('click',event=>{if(event.target.closest('button'))return;elements.fileInput.click();});
  elements.uploadBox.addEventListener('keydown',event=>{if(event.target!==elements.uploadBox)return;if(event.key==='Enter'||event.key===' '){event.preventDefault();elements.fileInput.click();}});
  document.addEventListener('dragenter',e=>{if(e.dataTransfer?.types?.includes('Files')){e.preventDefault();elements.appShell.classList.add('drag-over');}});
  document.addEventListener('dragover',e=>{if(e.dataTransfer?.types?.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
  document.addEventListener('dragleave',e=>{if(!e.relatedTarget||!document.documentElement.contains(e.relatedTarget))elements.appShell.classList.remove('drag-over');});
  document.addEventListener('drop',async e=>{e.preventDefault();elements.appShell.classList.remove('drag-over');if(!e.dataTransfer?.files.length)return;try{await importEntries(await fromDrop(e));}catch(err){showToast(err?.message||'読み込みに失敗しました。');}});
  // The preview uses an opaque-origin iframe, with no Service Worker or server.
  window.addEventListener('message',async(event)=>{
    if(event.source!==elements.previewFrame.contentWindow)return;
    const msg=event.data;
    if(!msg||!msg.asroPreview||msg.token!==state.token)return;
    if(msg.kind==='open'){
      if(state.files.has(msg.path)&&isHTML(msg.path))selectFile(msg.path);
      return;
    }
    if(msg.kind!=='fetch'||!Number.isInteger(msg.id))return;
    const target=state.files.get(msg.path);
    if(!target)return;
    const token=state.token;
    const frame=elements.previewFrame.contentWindow;
    try{
      const bytes=await target.arrayBuffer();
      if(token!==state.token||frame!==elements.previewFrame.contentWindow)return;
      frame.postMessage({asroPreview:true,token,kind:'fetch-result',id:msg.id,status:200,mime:mimeFor(msg.path),bytes},'*',[bytes]);
    }catch(error){
      frame.postMessage({asroPreview:true,token,kind:'fetch-result',id:msg.id,error:'ファイルを読み込めませんでした'},'*');
    }
  });
})();
