const fs = require('fs');
const filepath = 'pkg/web/server.go';

let content = fs.readFileSync(filepath, 'utf8');

// 1. Add to GET response
const getTarget = '"cf_turnstile_secret_key": ws.store.GetSetting("cf_turnstile_secret_key", ""),';
const getAdd = `
			"tg_backup_enabled":      ws.store.GetSetting("tg_backup_enabled", "false") == "true",
			"tg_bot_token":           ws.store.GetSetting("tg_bot_token", ""),
			"tg_chat_id":             ws.store.GetSetting("tg_chat_id", ""),
			"tg_backup_time":         ws.store.GetSetting("tg_backup_time", "02:00"),`;

if (!content.includes('"tg_bot_token":')) {
    content = content.replace(getTarget, getTarget + getAdd);
}

// 2. Add to allowedKeys
const allowTarget = '"cf_turnstile_secret_key":              true,';
const allowAdd = `
				"tg_backup_enabled":                    true,
				"tg_bot_token":                         true,
				"tg_chat_id":                           true,
				"tg_backup_time":                       true,`;

if (!content.includes('"tg_backup_enabled":                    true,')) {
    content = content.replace(allowTarget, allowTarget + allowAdd);
}

fs.writeFileSync(filepath, content);
console.log("Patched server.go");
