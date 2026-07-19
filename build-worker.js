const fs = require('fs');
const path = require('path');

log('开始构建 TriNet DNS - Cloudflare Worker 静态资源内嵌...');

const staticDir = path.join(__dirname, 'pkg', 'web', 'static');
const workerTemplateFile = path.join(__dirname, 'cloudflare-worker', 'src', 'index.js');
const workerOutFile = path.join(__dirname, 'cloudflare-worker', 'index.js');

try {
    // 1. 读取最新的静态资产文件
    const html = fs.readFileSync(path.join(staticDir, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(staticDir, 'style.css'), 'utf8');
    const js = fs.readFileSync(path.join(staticDir, 'app.js'), 'utf8');

    // 2. 转义处理，避免破坏 index.js 的反引号与模板字符串语法
    const escapeForTemplateLiteral = (str) => {
        return str
            .replace(/\\/g, '\\\\') // 转义反斜杠
            .replace(/`/g, '\\`')   // 转义反引号
            .replace(/\$/g, '\\$');  // 转义 $ 符号以防模板字符串插值
    };

    const escapedHtml = escapeForTemplateLiteral(html);
    const escapedCss = escapeForTemplateLiteral(css);
    const escapedJs = escapeForTemplateLiteral(js);

    // 3. 读取 index.js 模板并进行替换
    let workerCode = fs.readFileSync(workerTemplateFile, 'utf8');

    // 确保占位符存在
    if (!workerCode.includes('__HTML_PLACEHOLDER__')) {
        throw new Error('未在 Worker 源码中找到 __HTML_PLACEHOLDER__ 占位符');
    }

    workerCode = workerCode.replace('__HTML_PLACEHOLDER__', escapedHtml);
    workerCode = workerCode.replace('__CSS_PLACEHOLDER__', escapedCss);
    workerCode = workerCode.replace('__JS_PLACEHOLDER__', escapedJs);

    // 4. 将打包好的可部署版本输出写入
    fs.writeFileSync(workerOutFile, workerCode, 'utf8');

    log('✓ 成功将最新的 HTML/CSS/JS 前端资产打包内嵌至 `cloudflare-worker/index.js`！');
    log('现在您可以直接在 `cloudflare-worker/` 目录下执行 `wrangler deploy` 发布了。');

} catch (err) {
    error('构建失败: ' + err.message);
}

function log(msg) {
    console.log('\x1b[36m%s\x1b[0m', msg);
}

function error(msg) {
    console.error('\x1b[31m%s\x1b[0m', msg);
}
