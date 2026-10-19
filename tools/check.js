/**
 * 项目静态校验：node tools/check.js
 * 1. JS 语法（Function 构造解析）
 * 2. JSON 合法性
 * 3. app.json 页面四件套完整性
 * 4. 组件引用存在性
 * 5. WXML/JS/WXSS 中引用的本地图片存在
 * 6. WXML {{ }} 配对
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let errors = [], warns = [];

function walk(dir, exts, out = []) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) return;
      walk(p, exts, out);
    } else if (exts.includes(path.extname(e.name))) {
      out.push(p);
    }
  });
  return out;
}

// 1. JS 语法
walk(ROOT, ['.js']).forEach((f) => {
  const rel = path.relative(ROOT, f);
  if (rel.startsWith('tools')) return;
  try {
    // wx/Component/Page/App/getApp 为全局；用 vm 沙箱仅做解析
    const vm = require('vm');
    const src = fs.readFileSync(f, 'utf8');
    new vm.Script(src, { filename: rel });
  } catch (e) {
    errors.push(`[JS语法] ${rel}: ${e.message}`);
  }
});

// 2. JSON
walk(ROOT, ['.json']).forEach((f) => {
  const rel = path.relative(ROOT, f);
  try { JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { errors.push(`[JSON] ${rel}: ${e.message}`); }
});

// 3. 页面四件套
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const allPages = appJson.pages.concat(
  (appJson.subPackages || []).flatMap((sp) => sp.pages.map((p) => `${sp.root}/${p}`))
);
allPages.forEach((p) => {
  ['.wxml', '.wxss', '.js', '.json'].forEach((ext) => {
    if (!fs.existsSync(path.join(ROOT, p + ext))) errors.push(`[页面缺失] ${p}${ext}`);
  });
});

// 4. 组件引用
const jsonFiles = walk(ROOT, ['.json']).filter((f) => !f.endsWith('app.json') && !path.basename(f).startsWith('.'));
jsonFiles.forEach((f) => {
  const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
  const using = cfg.usingComponents || {};
  Object.entries(using).forEach(([tag, comp]) => {
    const base = comp.startsWith('/') ? path.join(ROOT, comp.slice(1)) : path.resolve(path.dirname(f), comp);
    if (!fs.existsSync(base + '.js')) errors.push(`[组件缺失] ${path.relative(ROOT, f)} 引用 ${comp}`);
  });
});

// 5. 本地图片引用存在
const imgExts = ['.png', '.jpg', '.jpeg', '.svg', '.gif'];
walk(ROOT, ['.wxml', '.js', '.wxss', '.json']).forEach((f) => {
  const rel = path.relative(ROOT, f);
  if (rel.startsWith('tools')) return;
  const src = fs.readFileSync(f, 'utf8');
  const re = /["'(]((?:\/[\w\u4e00-\u9fa5.-]+)+\.(?:png|jpg|jpeg|svg|gif))["')]/g;
  let m;
  while ((m = re.exec(src))) {
    const p = path.join(ROOT, m[1].slice(1));
    if (!fs.existsSync(p)) errors.push(`[图片缺失] ${rel}: ${m[1]}`);
  }
});

// 6. WXML {{ }} 配对
walk(ROOT, ['.wxml']).forEach((f) => {
  const rel = path.relative(ROOT, f);
  const src = fs.readFileSync(f, 'utf8');
  let open = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '{' && src[i + 1] === '{') { open++; i++; }
    else if (src[i] === '}' && src[i + 1] === '}') { open--; i++; if (open < 0) break; }
  }
  if (open !== 0) errors.push(`[WXML括号] ${rel}: {{ 与 }} 不配对 (${open})`);
});

// tabBar 图标
(appJson.tabBar ? appJson.tabBar.list : []).forEach((t) => {
  [t.iconPath, t.selectedIconPath].forEach((p) => {
    if (p && !fs.existsSync(path.join(ROOT, p))) errors.push(`[tabBar图标缺失] ${p}`);
  });
});

console.log(`页面总数: ${allPages.length}`);
console.log(`检查文件: JS/JSON/WXML/WXSS 全量`);
if (warns.length) console.log('\n警告:\n' + warns.join('\n'));
if (errors.length) {
  console.error('\n错误:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('\n✓ 全部校验通过');
