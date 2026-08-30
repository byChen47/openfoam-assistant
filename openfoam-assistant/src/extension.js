const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const os = require("os");

let words=[], classes=[], FILE_KEYWORDS={}, cppHeaders={}, cppIncludes=[], cppKeywords=[], dictBar, envBar, dictOn=false, envOn=false, envStore=null, extPath="", foamManualRoot="";

function load(ctx) {
    try{words=JSON.parse(fs.readFileSync(path.join(ctx.extensionPath,"data","tutorial_words.json"),"utf-8")).words||[];}catch(e){}
    try{classes=JSON.parse(fs.readFileSync(path.join(ctx.extensionPath,"data","cpp_classes.json"),"utf-8")).classes||[];}catch(e){}
    try{FILE_KEYWORDS=JSON.parse(fs.readFileSync(path.join(ctx.extensionPath,"data","file_keywords.json"),"utf-8"));}catch(e){}
    try{cppHeaders=JSON.parse(fs.readFileSync(path.join(ctx.extensionPath,"data","cpp_headers.json"),"utf-8"))||{};}catch(e){}
    try{cppIncludes=(JSON.parse(fs.readFileSync(path.join(ctx.extensionPath,"data","cpp_includes.json"),"utf-8")).includes)||[];}catch(e){}
    try{cppKeywords=(JSON.parse(fs.readFileSync(path.join(ctx.extensionPath,"data","cpp_keywords.json"),"utf-8")).keywords)||[];}catch(e){}
}

function isDictFile(doc) {
    if (doc.languageId === "openfoam-dict") return true;
    const p = doc.uri.fsPath.replace(/\\/g, "/");
    const parts = p.split("/");
    const dir = parts.length > 1 ? parts[parts.length - 2] : "";
    const fn = parts[parts.length - 1] || "";
    return (dir === "0" || dir === "0.org" || dir === "0.orig" || dir === "constant" || dir === "system") && !/\.(C|H|c|h|cc|hh|cpp|hpp|cxx|hxx)$/.test(fn);
}

function isCppFile(doc) {
    if (doc.languageId === "cpp") return true;
    return [".c",".h",".cc",".hh",".cpp",".hpp",".cxx",".hxx"].indexOf(path.extname(doc.uri.fsPath).toLowerCase()) >= 0;
}

function getFileKeywords(doc) {
    const fn = path.basename(doc.uri.fsPath.replace(/\\/g,"/"));
    const pd = path.basename(path.dirname(doc.uri.fsPath.replace(/\\/g,"/")));
    if (FILE_KEYWORDS[fn]) return FILE_KEYWORDS[fn];
    if ((pd==="0"||pd==="0.org"||pd==="0.orig") && FILE_KEYWORDS[fn]) return FILE_KEYWORDS[fn];
    if (pd==="0"||pd==="0.org"||pd==="0.orig") return ["dimensions","internalField","boundaryField","FoamFile","uniform","nonuniform","value","type","fixedValue","zeroGradient","inletOutlet","calculated","cyclic","symmetry","empty","wedge","processor"];
    return null;
}

function updateBars() {
    if(dictBar){dictBar.text=dictOn?"$(check) FOAMDict":"$(edit) FOAMDict";dictBar.tooltip=dictOn?"FOAMDict 补全已开启,点击关闭":"点击开启 FOAMDict 补全";dictBar.backgroundColor=dictOn?new vscode.ThemeColor("statusBarItem.warningBackground"):undefined;}
    if(envBar){envBar.text=envOn?"$(check) FOAMSRC":"$(edit) FOAMSRC";envBar.tooltip=envOn?"FOAMSRC 编译环境已开启,点击关闭":"点击开启 FOAMSRC 编译环境";envBar.backgroundColor=envOn?new vscode.ThemeColor("statusBarItem.warningBackground"):undefined;}
}

function showToggleInfoPanel(title, bodyHtml) {
    const panel = vscode.window.createWebviewPanel("openfoamToggleInfo", title, vscode.ViewColumn.One, { enableScripts: false });
    panel.webview.html =
        "<!DOCTYPE html><html lang=\"zh\"><head><meta charset=\"UTF-8\">" +
        "<style>" +
        "body{font-family:var(--vscode-font-family);padding:24px 36px;color:var(--vscode-foreground);background:var(--vscode-editor-background);line-height:1.7;}" +
        "h1{font-size:22px;margin-bottom:6px;}" +
        ".badge{display:inline-block;padding:2px 12px;border-radius:12px;background:var(--vscode-statusBarItem-warningBackground,#cca700);color:var(--vscode-statusBarItem-warningForeground,#000);font-size:12px;margin-bottom:14px;}" +
        "li{margin:8px 0;} code{font-family:var(--vscode-editor-font-family);background:var(--vscode-textCodeBlock-background);padding:1px 5px;border-radius:3px;}" +
        "</style></head><body>" + bodyHtml + "</body></html>";
}

function dictToggleInfoHtml() {
    return "<h1>FOAMDict 已开启</h1><div class=\"badge\">字典补全 ON</div>" +
        "<p><b>这个按钮的功能：</b>针对 OpenFOAM 字典文件（<code>0/</code>、<code>constant/</code>、<code>system/</code>）提供关键词补全与语法高亮，并按文件类型（如 <code>U</code>、<code>p</code>、<code>controlDict</code>）给出专属关键词。</p>" +
        "<p>再次点击状态栏 <code>FOAMDict</code> 即可关闭。</p>";
}

function envToggleInfoHtml(rootName) {
    const envLine = rootName ? "已接入 OpenFOAM 源码编译环境：<code>" + rootName + "</code>" : "未检测到 OpenFOAM 安装，已进入<strong>离线提示模式</strong>（类名、头文件与 <code>#include</code> 建议仍可用）。";
    return "<h1>FOAMSRC 已开启</h1><div class=\"badge\">编译环境 ON</div>" +
        "<p><b>这个按钮的功能：</b>" + envLine + "</p>" +
        "<ul>" +
        "<li>自动写入工作区 <code>.vscode</code> 配置（全部 <code>lnInclude</code> 目录、wmake 宏、文件关联）；</li>" +
        "<li>使用 OpenFOAM 安装的<strong>绝对路径</strong>写入 <code>.vscode</code> 配置（不创建源码软链接）；</li>" +
        "<li>提供 <code>wmake</code> / <code>wclean</code> 任务（<code>Ctrl+Shift+B</code>）；</li>" +
        "<li>写 <code>.C</code> / <code>.H</code> 代码时提供类名、头文件与 <code>#include</code> 提示。</li>" +
        "</ul>" +
        "<p>再次点击状态栏 <code>FOAMSRC</code> 即可关闭（自动还原 <code>.vscode</code> 配置）。</p>";
}

function foamVersionOf(root) {
    return parseInt((path.basename(root).match(/(\d+)/) || [0, 0])[1], 10);
}

function collectOpenFOAMRoots(ws) {
    const out = [];
    const keys = new Set();
    const add = r => {
        if (!r || !fs.existsSync(path.join(r, "etc", "bashrc"))) return;
        let key;
        try { key = fs.realpathSync(r); } catch (e) { key = r; }
        if (keys.has(key)) return;
        keys.add(key);
        out.push(r);
    };
    if (process.env.FOAM_ASSISTANT_OFFLINE === "1") return out;
    add(foamManualRoot);
    add(process.env.WM_PROJECT_DIR || (process.env.FOAM_SRC ? path.dirname(process.env.FOAM_SRC) : ""));
    if (ws) {
        for (const name of fs.readdirSync(ws)) {
            if (/^OpenFOAM-v?\d/.test(name)) add(path.join(ws, name));
        }
    }
    for (const base of [path.join(os.homedir(), "OpenFOAM"), "/opt/OpenFOAM", "/usr/local/OpenFOAM"]) {
        if (!fs.existsSync(base)) continue;
        for (const name of fs.readdirSync(base)) {
            if (/^OpenFOAM-v?\d/.test(name)) add(path.join(base, name));
        }
    }
    return out.sort((a, b) => foamVersionOf(b) - foamVersionOf(a));
}

function findOpenFOAMRoot(ws) {
    return collectOpenFOAMRoots(ws)[0] || null;
}

function collectLnInclude(root) {
    const out = [];
    (function walk(dir) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
        for (const en of entries) {
            if (en.name === "lnInclude" && en.isDirectory()) { out.push(path.join(dir, "lnInclude")); continue; }
            if (en.isDirectory() && !en.isSymbolicLink()) walk(path.join(dir, en.name));
        }
    })(root);
    return out.sort();
}

function findThirdPartyDirs(root) {
    const tpRoot = path.join(path.dirname(root), path.basename(root).replace(/^OpenFOAM/, "ThirdParty"));
    const dirs = [];
    if (!fs.existsSync(tpRoot)) return { root: null, dirs };
    const boost = path.join(tpRoot, "sources", "boost");
    if (fs.existsSync(boost)) for (const d of fs.readdirSync(boost)) if (fs.existsSync(path.join(boost, d))) dirs.push(path.join(boost, d));
    const cgal = path.join(tpRoot, "sources", "cgal");
    if (fs.existsSync(cgal)) for (const d of fs.readdirSync(cgal)) { const inc = path.join(cgal, d, "include"); if (fs.existsSync(inc)) dirs.push(inc); }
    return { root: tpRoot, dirs };
}

const ENV_FILES = ["c_cpp_properties.json", "tasks.json", "settings.json"];

function getWorkspacePath() {
    return (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]) ? vscode.workspace.workspaceFolders[0].uri.fsPath : "";
}

function buildEnvConfig(ws, root, globalMode) {
    const inc = collectLnInclude(root);
    const tp = findThirdPartyDirs(root);
    const opt = process.env.WM_OPTIONS || "";
    const ver = (path.basename(root).match(/v?(\d+)/) || [0, "2206"])[1];
    const defines = ["OPENFOAM=" + ver, "WM_DP", "WM_LABEL_SIZE=32", "NoRepository"];
    if (opt) { defines[1] = /SP/.test(opt) ? "WM_SP" : "WM_DP"; defines[2] = /Int64/.test(opt) ? "WM_LABEL_SIZE=64" : "WM_LABEL_SIZE=32"; }
    // 一律使用绝对路径(不在工作区创建 OpenFOAM 源码软链接)
    const toPath = p => p.replace(/\\/g, "/");
    const mode = process.platform === "darwin" ? "macos-gcc-x64" : process.platform === "win32" ? "windows-gcc-x64" : "linux-gcc-x64";
    const compiler = fs.existsSync("/usr/bin/g++") ? "/usr/bin/g++" : "g++";
    const props = {
        configurations: [{
            name: path.basename(root) + " (" + (opt || "linux64GccDPInt32Opt") + ")",
            compilerPath: compiler, cppStandard: "c++14", cStandard: "c11", intelliSenseMode: mode,
            defines: defines,
            forcedInclude: [path.join(extPath, "data", "foamCompat.H")],
            includePath: ["${workspaceFolder}/**"].concat(inc.map(toPath), tp.dirs.map(toPath)),
            browse: { path: ["${workspaceFolder}", toPath(path.join(root, "src")), toPath(path.join(root, "applications"))], limitSymbolsToIncludedHeaders: true }
        }],
        version: 4
    };
    const src = path.join(root, "etc", "bashrc");
    const tasks = {
        version: "2.0.0",
        tasks: [
            { label: "wmake: 编译当前文件夹", type: "shell", command: "bash -lc 'source " + src + " && wmake'", options: { cwd: "${fileDirname}" }, group: "build", problemMatcher: ["$gcc"] },
            { label: "wclean: 清理当前文件夹", type: "shell", command: "bash -lc 'source " + src + " && wclean'", options: { cwd: "${fileDirname}" }, group: "build" }
        ]
    };
    const settings = {
        "files.associations": { "*.C": "cpp", "*.H": "cpp" },
        "files.watcherExclude": (() => { const e = { ["**/" + path.basename(root) + "/**"]: true }; if (tp.root) e["**/" + path.basename(tp.root) + "/**"] = true; return e; })()
    };
    return { inc: inc, tp: tp, props: props, tasks: tasks, settings: settings, bashrc: src };
}

function backupVscodeFiles(ws, info) {
    info.backups = info.backups || {};
    const vscodeDir = path.join(ws, ".vscode");
    const bk = path.join(vscodeDir, ".openfoam-backup");
    fs.mkdirSync(vscodeDir, { recursive: true });
    for (const f of ENV_FILES) {
        const fp = path.join(vscodeDir, f);
        if (!info.backups[f] && fs.existsSync(fp)) {
            fs.mkdirSync(bk, { recursive: true });
            fs.copyFileSync(fp, path.join(bk, f));
            info.backups[f] = true;
        }
    }
}

function applyOpenFOAMEnv(ws, root, info) {
    backupVscodeFiles(ws, info);
    const cfg = buildEnvConfig(ws, root);
    const vscodeDir = path.join(ws, ".vscode");
    fs.mkdirSync(vscodeDir, { recursive: true });
    fs.writeFileSync(path.join(vscodeDir, "c_cpp_properties.json"), JSON.stringify(cfg.props, null, 4) + "\n");
    fs.writeFileSync(path.join(vscodeDir, "tasks.json"), JSON.stringify(cfg.tasks, null, 4) + "\n");
    fs.writeFileSync(path.join(vscodeDir, "settings.json"), JSON.stringify(cfg.settings, null, 4) + "\n");
    info.root = root;
    return cfg.inc.length;
}

function writeOfflineEnvConfig(ws, info) {
    backupVscodeFiles(ws, info);
    const vscodeDir = path.join(ws, ".vscode");
    fs.mkdirSync(vscodeDir, { recursive: true });
    const props = {
        configurations: [{
            name: "OpenFOAM (offline hints)",
            compilerPath: "/usr/bin/g++",
            cppStandard: "c++14",
            defines: ["FOAM_ASSISTANT_OFFLINE=1"],
            forcedInclude: [path.join(extPath, "data", "foamCompat.H")],
            includePath: ["${workspaceFolder}/**", path.join(extPath, "data", "stubs")]
        }],
        version: 4
    };
    fs.writeFileSync(path.join(vscodeDir, "c_cpp_properties.json"), JSON.stringify(props, null, 4) + "\n");
    const settings = { "files.associations": { "*.C": "cpp", "*.H": "cpp" } };
    fs.writeFileSync(path.join(vscodeDir, "settings.json"), JSON.stringify(settings, null, 4) + "\n");
}

function revertOpenFOAMEnv(ws, info) {
    const vscodeDir = path.join(ws, ".vscode");
    const bk = path.join(vscodeDir, ".openfoam-backup");
    for (const f of ENV_FILES) {
        const fp = path.join(vscodeDir, f);
        const bfp = path.join(bk, f);
        try {
            if (fs.existsSync(bfp)) fs.copyFileSync(bfp, fp);
            else if (fs.existsSync(fp)) fs.unlinkSync(fp);
        } catch (e) {}
    }
    for (const name of (info.symlinks || [])) {
        const link = path.join(ws, name);
        try { if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link); } catch (e) {}
    }
    try { fs.rmSync(bk, { recursive: true, force: true }); } catch (e) {}
}

function getUserSettingsDir() {
    const home = os.homedir();
    if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "Code", "User");
    if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Code", "User");
    return path.join(home, ".config", "Code", "User");
}

function mergeUserTasks(root) {
    const dir = getUserSettingsDir();
    const fp = path.join(dir, "tasks.json");
    const src = path.join(root, "etc", "bashrc");
    const newTasks = [
        { label: "wmake: 编译当前文件夹", type: "shell", command: "bash -lc 'source " + src + " && wmake'", options: { cwd: "${fileDirname}" }, group: "build", problemMatcher: ["$gcc"] },
        { label: "wclean: 清理当前文件夹", type: "shell", command: "bash -lc 'source " + src + " && wclean'", options: { cwd: "${fileDirname}" }, group: "build" }
    ];
    let data = { version: "2.0.0", tasks: [] };
    try { if (fs.existsSync(fp)) data = JSON.parse(fs.readFileSync(fp, "utf-8")); } catch (e) {}
    data.tasks = data.tasks || [];
    for (const t of newTasks) if (!data.tasks.some(x => x.label === t.label)) data.tasks.push(t);
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(fp, JSON.stringify(data, null, 4) + "\n"); } catch (e) {}
}

async function applyGlobalOpenFOAMEnv(roots) {
    const primary = roots[0];
    const cfg = buildEnvConfig("", primary, true);
    const allInc = [];
    for (const r of roots) {
        allInc.push(...collectLnInclude(r));
        const tp = findThirdPartyDirs(r);
        allInc.push(...tp.dirs);
    }
    const incSet = [...new Set(allInc)];
    const cpp = vscode.workspace.getConfiguration("C_Cpp");
    const oldInc = cpp.get("default.includePath") || [];
    const mergedInc = oldInc.filter(p => p.indexOf("OpenFOAM") < 0 && p.indexOf("ThirdParty") < 0).concat(incSet);
    await cpp.update("default.includePath", [...new Set(mergedInc)], vscode.ConfigurationTarget.Global);
    const oldDef = cpp.get("default.defines") || [];
    const mergedDef = oldDef.filter(d => !/^(OPENFOAM=|WM_|NoRepository)/.test(d)).concat(cfg.props.configurations[0].defines);
    await cpp.update("default.defines", mergedDef, vscode.ConfigurationTarget.Global);
    await cpp.update("default.compilerPath", cfg.props.configurations[0].compilerPath, vscode.ConfigurationTarget.Global);
    await cpp.update("default.cppStandard", "c++14", vscode.ConfigurationTarget.Global);
    await cpp.update("default.cStandard", "c11", vscode.ConfigurationTarget.Global);
    await cpp.update("default.intelliSenseMode", cfg.props.configurations[0].intelliSenseMode, vscode.ConfigurationTarget.Global);
    const compat = path.join(extPath, "data", "foamCompat.H");
    const oldFi = cpp.get("default.forcedInclude") || [];
    if (oldFi.indexOf(compat) < 0) await cpp.update("default.forcedInclude", oldFi.concat([compat]), vscode.ConfigurationTarget.Global);
    const files = vscode.workspace.getConfiguration("files");
    const assoc = files.get("associations") || {};
    await files.update("associations", Object.assign({}, assoc, { "*.C": "cpp", "*.H": "cpp" }), vscode.ConfigurationTarget.Global);
    mergeUserTasks(primary);
    return { count: incSet.length, roots: roots };
}

function toggleOpenFOAMEnv() {
    const ws = getWorkspacePath();
    if (envOn) {
        const info = (envStore.get("openfoamEnv") || {}).info || {};
        if (ws) revertOpenFOAMEnv(ws, info);
        envOn = false;
        envStore.update("openfoamEnv", { on: false, info: null });
        updateBars();
        return;
    }
    if (!ws) {
        // 没有打开文件夹时,只启用内置离线提示(不写 .vscode 配置)
        envOn = true;
        envStore.update("openfoamEnv", { on: true, info: { symlinks: [], backups: {}, root: "" } });
        updateBars();
        showToggleInfoPanel("FOAMSRC 已开启", envToggleInfoHtml(null) + "<p>（未打开工作区文件夹：仅离线代码提示生效，头文件解析需打开文件夹并安装 OpenFOAM。）</p>");
        return;
    }
    const root = findOpenFOAMRoot(ws);
    if (!root) {
        envOn = true;
        const info = { symlinks: [], backups: {} };
        writeOfflineEnvConfig(ws, info);
        envStore.update("openfoamEnv", { on: true, info: Object.assign(info, { root: "" }) });
        updateBars();
        showToggleInfoPanel("FOAMSRC 已开启", envToggleInfoHtml(null));
        return;
    }
    const info = { symlinks: [], backups: {} };
    const n = applyOpenFOAMEnv(ws, root, info);
    envOn = true;
    envStore.update("openfoamEnv", { on: true, info: info });
    updateBars();
    showToggleInfoPanel("FOAMSRC 已开启", envToggleInfoHtml(path.basename(root)));
}

function openEnvTerminal() {
    const root = findOpenFOAMRoot(getWorkspacePath());
    if (!root) { vscode.window.showWarningMessage("未找到 OpenFOAM 安装。"); return; }
    const term = vscode.window.createTerminal({ name: "OpenFOAM" });
    term.sendText("source " + path.join(root, "etc", "bashrc") + "; echo OpenFOAM env ready");
    term.show();
}

async function activate(ctx) {
    load(ctx);
    extPath = ctx.extensionPath;
    foamManualRoot = ctx.globalState.get("foamManualRoot") || "";
    envStore = ctx.workspaceState;
    const saved = envStore.get("openfoamEnv");
    if (saved && saved.on) {
        envOn = true;
        const ws = getWorkspacePath();
        if (ws && saved.info && saved.info.root) { try { applyOpenFOAMEnv(ws, saved.info.root, saved.info); } catch (e) {} }
    }
    const L="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_".split("");

    ctx.subscriptions.push(vscode.languages.registerCompletionItemProvider({scheme:"file"},{
        provideCompletionItems(doc,pos) {
            if(!dictOn || !isDictFile(doc)) return[];
            const m=doc.lineAt(pos.line).text.substring(0,pos.character).match(/([A-Za-z_]\w*)$/);
            if(!m||m[1].length<1) return[];
            const w=m[1].toLowerCase(), wl=m[1].length;
            const fk=getFileKeywords(doc);
            let sw=words;
            if(fk&&fk.length>0) sw=[...new Set([...fk,...words])];
            const items=[], prefix=[], substr=[];
            for(const word of sw) {
                if(word===m[1]) continue;
                const lw=word.toLowerCase();
                if(lw.startsWith(w)) prefix.push(word);
                else if(w.length>=2&&lw.includes(w)) substr.push(word);
            }
            for(const word of prefix.slice(0,60)) {
                const item=new vscode.CompletionItem(word, vscode.CompletionItemKind.Text);
                item.filterText=word; item.sortText="0_"+word;
                item.range=new vscode.Range(pos.line,pos.character-wl,pos.line,pos.character);
                items.push(item);
            }
            for(const word of substr.slice(0,40)) {
                const item=new vscode.CompletionItem(word, vscode.CompletionItemKind.Text);
                item.filterText=word; item.sortText="1_"+word;
                item.range=new vscode.Range(pos.line,pos.character-wl,pos.line,pos.character);
                items.push(item);
            }
            return items;
        }
    }, ...L));

    ctx.subscriptions.push(vscode.languages.registerCompletionItemProvider({scheme:"file"},{
        provideCompletionItems(doc,pos) {
            if(!envOn || !isCppFile(doc)) return[];
            const line=doc.lineAt(pos.line).text.substring(0,pos.character);
            if(line.trim().startsWith("//")) return[];
            const inc=line.match(/#include\s*([<"]?)([\w./-]*)$/);
            if(inc) {
                const q=inc[2].toLowerCase(), open=inc[1]==="<", items=[], seen=new Set();
                const push=(base,detail,prio)=>{
                    if(seen.has(base)||!base.toLowerCase().startsWith(q)) return;
                    const item=new vscode.CompletionItem(base, vscode.CompletionItemKind.File);
                    item.filterText=base; item.sortText=prio+"_"+base; item.detail=detail;
                    item.insertText=new vscode.SnippetString((open?"<":"\"")+base+(open?">":"\""));
                    item.range=new vscode.Range(pos.line,pos.character-inc[2].length,pos.line,pos.character);
                    items.push(item); seen.add(base);
                };
                for(const h of cppIncludes) push(h.name,"OpenFOAM 常用 · "+h.desc,"0");
                for(const e of Object.entries(cppHeaders.classes||{})) {
                    const base=e[1].split("/").pop();
                    push(base,"OpenFOAM 头文件 · "+e[1],"1");
                    if(items.length>=100) break;
                }
                return items;
            }
            const m=line.match(/([A-Za-z_:]\w*)$/);
            if(!m||m[1].length<1) return[];
            const w=m[1].toLowerCase(), wl=m[1].length, items=[];
            for(const k of cppKeywords) {
                if(!k.word.toLowerCase().startsWith(w) || k.word.toLowerCase()===w) continue;
                const item=new vscode.CompletionItem(k.word, k.snippet? vscode.CompletionItemKind.Snippet : vscode.CompletionItemKind.Keyword);
                item.filterText=k.word; item.sortText="0_"+k.word;
                item.detail="OpenFOAM · "+(k.desc||"");
                if(k.snippet) item.insertText=new vscode.SnippetString(k.snippet);
                else item.insertText=k.word;
                item.range=new vscode.Range(pos.line,pos.character-wl,pos.line,pos.character);
                items.push(item);
            }
            for(const c of classes) {
                if(!c.toLowerCase().startsWith(w)||c===m[1]) continue;
                const item=new vscode.CompletionItem(c, vscode.CompletionItemKind.Class);
                item.filterText=c;
                const hdr=(cppHeaders.classes||{})[c];
                if(hdr) {
                    const base=hdr.split("/").pop();
                    item.detail="OpenFOAM · "+base;
                    item.documentation=new vscode.MarkdownString("`#include \""+base+"\"`\n\n"+hdr);
                }
                item.range=new vscode.Range(pos.line,pos.character-wl,pos.line,pos.character);
                items.push(item); if(items.length>=30) break;
            }
            return items;
        }
    }, ...L, ":", ">"));

    ctx.subscriptions.push(vscode.languages.registerHoverProvider({scheme:"file"},{
        provideHover(doc,pos) {
            if(!envOn || !isCppFile(doc)) return null;
            const hoverLine=doc.lineAt(pos.line).text;
            const incMatch=hoverLine.match(/#include\s*["<]([\w./-]+)[">]/);
            if(incMatch) {
                const nameStart=hoverLine.indexOf(incMatch[1]);
                if(pos.character>=nameStart && pos.character<=nameStart+incMatch[1].length) {
                    const name=incMatch[1].split("/").pop();
                    const md=new vscode.MarkdownString();
                    let found=false;
                    for(const h of cppIncludes) {
                        if(h.name===name) { md.appendMarkdown("**OpenFOAM 头文件** `"+name+"`\n\n"+(h.desc||"")); found=true; break; }
                    }
                    if(!found) {
                        const defs=[];
                        for(const e of Object.entries(cppHeaders.classes||{})) {
                            if(e[1].split("/").pop()===name) { defs.push(e[0]); if(defs.length>=5) break; }
                        }
                        if(defs.length) { md.appendMarkdown("**OpenFOAM 头文件** `"+name+"`\n\n定义了：`"+defs.join("`, `")+"`"); found=true; }
                    }
                    if(!found) md.appendMarkdown("**OpenFOAM 头文件** `"+name+"`");
                    const savedRoot=((envStore.get("openfoamEnv")||{}).info||{}).root||"";
                    if(!savedRoot) md.appendMarkdown("\n\n（离线模式：仅名称提示。头文件内容解析需要安装 OpenFOAM 或把源码放进工作区。）");
                    return new vscode.Hover(md, new vscode.Range(pos.line,nameStart,pos.line,nameStart+incMatch[1].length));
                }
            }
            const range=doc.getWordRangeAtPosition(pos,/[A-Za-z_][A-Za-z0-9_:]*/);
            if(!range) return null;
            const word=doc.getText(range);
            const md=new vscode.MarkdownString();
            for(const k of cppKeywords) {
                if(k.word!==word) continue;
                md.appendMarkdown("**OpenFOAM** · "+(k.desc||word));
                if(k.snippet) md.appendCodeblock(k.snippet,"cpp");
                return new vscode.Hover(md,range);
            }
            const hdr=(cppHeaders.classes||{})[word];
            if(hdr) {
                const base=hdr.split("/").pop();
                md.appendMarkdown("**OpenFOAM 类** `"+word+"`\n\n`#include \""+base+"\"`\n\n"+hdr);
                return new vscode.Hover(md,range);
            }
            return null;
        }
    }));

    dictBar=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right,99);updateBars();dictBar.command="openfoam.toggleDict";dictBar.show();
    ctx.subscriptions.push(dictBar,vscode.commands.registerCommand("openfoam.toggleDict",()=>{
        dictOn=!dictOn;
        updateBars();
        if(dictOn) showToggleInfoPanel("FOAMDict 已开启", dictToggleInfoHtml());
    }));
    envBar=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right,98);updateBars();envBar.command="openfoam.toggleEnv";envBar.show();
    ctx.subscriptions.push(envBar,vscode.commands.registerCommand("openfoam.toggleEnv",toggleOpenFOAMEnv));
    ctx.subscriptions.push(vscode.commands.registerCommand("openfoam.setupCppIntelliSense",()=>{
        if(!envOn) toggleOpenFOAMEnv();
        else {
            const savedRoot = ((envStore.get("openfoamEnv") || {}).info || {}).root || "";
            showToggleInfoPanel("FOAMSRC 已开启", envToggleInfoHtml(savedRoot ? path.basename(savedRoot) : null));
        }
    }));
    ctx.subscriptions.push(vscode.commands.registerCommand("openfoam.openEnvTerminal",openEnvTerminal));
    ctx.subscriptions.push(vscode.commands.registerCommand("openfoam.setFoamRoot", async () => {
        const pick = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: "选择 OpenFOAM 安装目录(含 etc/bashrc)" });
        if (!pick || !pick.length) return;
        const root = pick[0].fsPath;
        if (!fs.existsSync(path.join(root, "etc", "bashrc"))) { vscode.window.showWarningMessage("所选目录不是 OpenFOAM 安装目录(缺少 etc/bashrc)。"); return; }
        foamManualRoot = root;
        await ctx.globalState.update("foamManualRoot", root);
        if (envOn) {
            const ws = getWorkspacePath();
            const info = ((envStore.get("openfoamEnv") || {}).info || {});
            try { applyOpenFOAMEnv(ws, root, info); } catch (e) {}
        }
        vscode.window.showInformationMessage("已设置 OpenFOAM 安装目录：" + root);
    }));
    ctx.subscriptions.push(vscode.commands.registerCommand("openfoam.applyGlobalEnv", async () => {
        const roots = collectOpenFOAMRoots(getWorkspacePath());
        if (!roots.length) { vscode.window.showWarningMessage("未检测到 OpenFOAM 安装。"); return; }
        const res = await applyGlobalOpenFOAMEnv(roots);
        await ctx.globalState.update("foamGlobalApplied", ctx.extension.packageJSON.version);
        vscode.window.showInformationMessage("已重新应用全局 OpenFOAM IntelliSense 配置(" + roots.length + " 个版本,共 " + res.count + " 个 lnInclude 目录)。");
    }));
    const autoRoots = collectOpenFOAMRoots(getWorkspacePath());
    if (autoRoots.length) {
        const ver = ctx.extension.packageJSON.version;
        const compat = path.join(extPath, "data", "foamCompat.H");
        const needApply = ctx.globalState.get("foamGlobalApplied") !== ver
            || (vscode.workspace.getConfiguration("C_Cpp").get("default.forcedInclude") || []).indexOf(compat) < 0;
        if (needApply) {
            try {
                const res = await applyGlobalOpenFOAMEnv(autoRoots);
                await ctx.globalState.update("foamGlobalApplied", ver);
                vscode.window.showInformationMessage("检测到 " + autoRoots.length + " 个 OpenFOAM 版本(" + autoRoots.map(r => path.basename(r)).join(", ") + ")，已自动写入全局 C++ IntelliSense 配置(共 " + res.count + " 个 lnInclude 目录)，无需手动设置。");
            } catch (e) {}
        }
    }
}
function deactivate() {}
module.exports = { activate, deactivate };
