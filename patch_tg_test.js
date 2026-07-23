const fs = require('fs');

const goImpl = `
func (ws *WebServer) handleTestTGBackup(w http.ResponseWriter, r *http.Request) {
	_, ok := ws.checkAuth(w, r)
	if !ok {
		return
	}
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	token := ws.store.GetSetting("tg_bot_token", "")
	chatId := ws.store.GetSetting("tg_chat_id", "")

	if token == "" || chatId == "" {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(\`{"error":"请先保存 Telegram Bot Token 和 Chat ID"}\`))
		return
	}

	err := ws.store.ExecuteTGBackup(token, chatId)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf(\`{"error":"%s"}\`, err.Error())))
		return
	}

	w.Write([]byte(\`{"status":"success","message":"推送成功"}\`))
}
`;

let serverGo = fs.readFileSync('pkg/web/server.go', 'utf8');
if (!serverGo.includes('handleTestTGBackup(w http.ResponseWriter')) {
    serverGo += '\n' + goImpl;
    fs.writeFileSync('pkg/web/server.go', serverGo);
    console.log('Patched server.go');
}

const jsHTML = `
                                <div style="display: flex; gap: 12px; margin-top: 8px;">
                                    <button type="submit" class="btn btn-primary">保存 Telegram 备份配置</button>
                                    <button type="button" class="btn btn-secondary" onclick="testTGBackup()" style="background: var(--primary-light); color: var(--primary-color);">立即测试推送</button>
                                </div>
`;

function processIndex(filepath) {
    if (!fs.existsSync(filepath)) return;
    let content = fs.readFileSync(filepath, 'utf8');
    const target = `<div style="display: flex; gap: 12px; margin-top: 8px;">
                                    <button type="submit" class="btn btn-primary">保存 Telegram 备份配置</button>
                                </div>`;
    if (content.includes(target) && !content.includes('testTGBackup()')) {
        content = content.replace(target, jsHTML.trim());
        fs.writeFileSync(filepath, content);
        console.log('Patched ' + filepath);
    }
}

const jsImpl = `
async function testTGBackup() {
    try {
        const res = await fetchAPI('/api/admin/tg_backup/test', {
            method: 'POST'
        });
        if (res.ok) {
            alert('🎉 数据库备份推送成功！请查看您的 Telegram。');
        } else {
            const data = await res.json();
            alert('推送失败: ' + (data.error || '未知错误'));
        }
    } catch (err) {
        alert('网络错误: ' + err.message);
    }
}
`;

function processAppJs(filepath) {
    if (!fs.existsSync(filepath)) return;
    let content = fs.readFileSync(filepath, 'utf8');
    if (!content.includes('testTGBackup()')) {
        content += '\n' + jsImpl;
        fs.writeFileSync(filepath, content);
        console.log('Patched ' + filepath);
    }
}

processIndex('pkg/web/static/index.html');
processIndex('web/index.html');
processAppJs('pkg/web/static/app.js');
processAppJs('web/app.js');
