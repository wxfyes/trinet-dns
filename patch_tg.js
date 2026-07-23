const fs = require('fs');

const tgHTML = `
                        <!-- 数据库自动备份 (Telegram) -->
                        <div class="card" style="padding: 24px; margin-bottom: 24px;">
                            <h3 style="margin-bottom: 16px; font-size: 1.1rem; display: flex; align-items: center; gap: 8px;">
                                💾 数据库云端灾备 (Telegram)
                            </h3>
                            <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-color); margin-bottom: 16px;">
                                <div>
                                    <h4 style="margin: 0; font-size: 0.95rem;">启用 Telegram 每日定时备份</h4>
                                    <p style="color: var(--text-muted); font-size: 0.85rem; margin: 4px 0 0 0;">每天定时将最新的 data.db 数据库备份发送到指定的 Telegram 机器人/群组</p>
                                </div>
                                <label class="switch-container">
                                    <input type="checkbox" id="setting-tg-enabled" onchange="updateBasicSetting('tg_backup_enabled', this.checked)">
                                    <span class="switch-slider"></span>
                                </label>
                            </div>
                            <form id="setting-tg-form" onsubmit="saveTGBackupSettings(event)">
                                <div class="form-row">
                                    <div class="form-group">
                                        <label for="setting-tg-bot-token">Telegram Bot Token</label>
                                        <input type="text" id="setting-tg-bot-token" placeholder="例如: 123456789:ABCDefGHIJKlmNop" class="form-control font-mono">
                                    </div>
                                    <div class="form-group">
                                        <label for="setting-tg-chat-id">Chat ID (接收群组/用户 ID)</label>
                                        <input type="text" id="setting-tg-chat-id" placeholder="例如: 123456789 或 -1001234567" class="form-control font-mono">
                                    </div>
                                    <div class="form-group">
                                        <label for="setting-tg-backup-time">每日备份时间 (HH:MM)</label>
                                        <input type="time" id="setting-tg-backup-time" class="form-control font-mono">
                                    </div>
                                </div>
                                <div style="display: flex; gap: 12px; margin-top: 8px;">
                                    <button type="submit" class="btn btn-primary">保存 Telegram 备份配置</button>
                                </div>
                            </form>
                        </div>
`;

const tgJS = `
async function saveTGBackupSettings(event) {
    event.preventDefault();
    const token = document.getElementById('setting-tg-bot-token').value.trim();
    const chatId = document.getElementById('setting-tg-chat-id').value.trim();
    let time = document.getElementById('setting-tg-backup-time').value.trim();
    if (!time) time = "02:00";

    try {
        const res = await fetchAPI('/api/admin/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tg_bot_token: token,
                tg_chat_id: chatId,
                tg_backup_time: time
            })
        });

        if (res.ok) {
            alert('Telegram 备份配置保存成功！');
            loadSettingsPage();
        } else {
            const data = await res.json();
            alert('保存失败: ' + (data.error || '未知错误'));
        }
    } catch (err) {
        alert('网络错误: ' + err.message);
    }
}
`;

function processIndex(filepath) {
    if (!fs.existsSync(filepath)) return;
    let content = fs.readFileSync(filepath, 'utf8');
    if (content.includes('数据库云端灾备 (Telegram)')) return;

    const target = '<!-- Cloudflare 三网优选 IP 自动同步 -->';
    if (content.includes(target)) {
        content = content.replace(target, tgHTML + '\n                        ' + target);
        fs.writeFileSync(filepath, content, 'utf8');
        console.log("Patched " + filepath);
    }
}

function processAppJs(filepath) {
    if (!fs.existsSync(filepath)) return;
    let content = fs.readFileSync(filepath, 'utf8');
    if (content.includes('saveTGBackupSettings')) return;

    content += "\n" + tgJS;
    
    // update loadSettingsPage to load new keys
    const loadTarget = "document.getElementById('setting-cf-enabled').checked = (data.cf_turnstile_enabled === 'true');";
    const loadRepl = loadTarget + `
        document.getElementById('setting-tg-enabled').checked = (data.tg_backup_enabled === 'true');
        document.getElementById('setting-tg-bot-token').value = data.tg_bot_token || '';
        document.getElementById('setting-tg-chat-id').value = data.tg_chat_id || '';
        document.getElementById('setting-tg-backup-time').value = data.tg_backup_time || '02:00';
`;
    content = content.replace(loadTarget, loadRepl);
    
    fs.writeFileSync(filepath, content, 'utf8');
    console.log("Patched " + filepath);
}

processIndex('web/index.html');
processIndex('pkg/web/static/index.html');
processAppJs('web/app.js');
processAppJs('pkg/web/static/app.js');
