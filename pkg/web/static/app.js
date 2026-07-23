// HTML 瀛楃瀹夊叏杞箟闃叉敞鍏ュ嚱鏁?function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 閫氱敤鏂囨湰涓€閿鍒跺伐鍏峰嚱鏁?function copyTextToClipboard(text) {
    if (!text) return;
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
            alert('宸叉垚鍔熷鍒跺埌鍓创鏉匡紒');
        }).catch(err => {
            fallbackCopyText(text);
        });
    } else {
        fallbackCopyText(text);
    }
}

function fallbackCopyText(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        document.execCommand('copy');
        alert('宸叉垚鍔熷鍒跺埌鍓创鏉匡紒');
    } catch (err) {
        alert('澶嶅埗澶辫触锛岃鎵嬪姩澶嶅埗');
    }
    document.body.removeChild(textArea);
}

function copyCodeContent(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    copyTextToClipboard(el.innerText);
}

// API 璇锋眰缁熶竴灏佽锛岃嚜鍔ㄦ敞鍏?Authorization Token 骞跺鐞?401 鏈巿鏉?async function fetchAPI(url, options = {}) {
    const token = localStorage.getItem('trinet_token');
    if (!options.headers) {
        options.headers = {};
    }
    if (token) {
        options.headers['Authorization'] = 'Bearer ' + token;
    }
    
    const res = await fetch(url, options);
    if (res.status === 401) {
        logout();
        throw new Error('鐧诲綍浼氳瘽宸茶繃鏈燂紝璇烽噸鏂扮櫥褰?);
    }
    return res;
}

// 鍏ㄥ眬閰嶇疆涓?Turnstile 鐘舵€?let serverSettings = { open_registration: false, cf_turnstile_enabled: false, cf_turnstile_site_key: '' };
let turnstileWidgetId = null;
let turnstileToken = '';

// 妫€鏌ョ櫥褰曠姸鎬佸苟鍒囨崲鐣岄潰
function checkLogin() {
    const token = localStorage.getItem('trinet_token');
    const role = localStorage.getItem('trinet_role');
    const loginOverlay = document.getElementById('login-overlay');
    const appContainer = document.getElementById('app-container');
    const menuSettings = document.getElementById('menu-settings');
    const menuUsers = document.getElementById('menu-users');
    if (token) {
        loginOverlay.style.display = 'none';
        appContainer.style.display = 'flex';
        document.documentElement.classList.add('logged-in');
        
        if (role === 'admin') {
            if (menuSettings) menuSettings.style.display = 'flex';
            if (menuUsers) menuUsers.style.display = 'flex';
        } else {
            if (menuSettings) menuSettings.style.display = 'none';
            if (menuUsers) menuUsers.style.display = 'none';
        }

        // 鍔犺浇璁块棶鑰?IP
        loadVisitorIP();

        // 鑻ユ湰鍦拌鑹茬紦瀛樼己澶憋紝鑷姩鍚戝悗绔媺鍙栨牎鍑嗭紝閬垮厤鍘嗗彶浼氳瘽娌℃湁缂撳瓨 role 瀛楁瀵艰嚧鑿滃崟闅愯棌
        if (!role) {
            fetchAPI('/api/user/billing')
                .then(res => {
                    if (res.ok) return res.json();
                    throw new Error('Failed to fetch profile');
                })
                .then(data => {
                    if (data.role) {
                        localStorage.setItem('trinet_role', data.role);
                        if (menuSettings) {
                            menuSettings.style.display = data.role === 'admin' ? 'flex' : 'none';
                        }
                    }
                })
                .catch(err => console.error('鑷姩鎷夊彇鐢ㄦ埛瑙掕壊澶辫触:', err));
        }
        
        // 棣栧睆鎭㈠鏍囩椤靛墠鍏堝己琛屽姞杞藉畬鏁寸殑鍚庣鏁版嵁
        loadRecords().then(() => {
            const hashTab = window.location.hash.replace('#', '');
            if (hashTab && document.getElementById(`tab-${hashTab}`)) {
                switchTab(hashTab);
            }
        });
        setupLogStream();
    } else {
        document.documentElement.classList.remove('logged-in');
        loginOverlay.style.display = 'flex';
        appContainer.style.display = 'none';
        if (menuSettings) menuSettings.style.display = 'none';
        if (logSource) {
            logSource.close();
            logSource = null;
        }
        initLoginConfig();
    }
}

// 鑾峰彇寮€鏀炬敞鍐岄厤缃苟璁剧疆 UI
async function initLoginConfig() {
    try {
        const res = await fetch('/api/login');
        if (res.ok) {
            const data = await res.json();
            serverSettings = data; // 淇濆瓨鍏ㄥ眬鍙橀噺
            const regLink = document.getElementById('reg-link-container');
            if (data.open_registration) {
                regLink.style.display = 'block';
            } else {
                regLink.style.display = 'none';
            }
        }
    } catch (err) {
        console.error('鏃犳硶杞藉叆寮€鏀炬敞鍐岄厤缃?, err);
    }
}

// 鍒囨崲鐧诲綍鍜屾敞鍐岀晫闈?function toggleLoginReg(showReg) {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const title = document.getElementById('login-box-title');
    const desc = document.getElementById('login-box-desc');
    const turnstileContainer = document.getElementById('cf-turnstile-container');
    
    if (showReg) {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        title.innerText = '鐢ㄦ埛娉ㄥ唽';
        desc.innerText = '鍒涘缓涓€涓柊鐨?TriNet 瑙ｆ瀽璐︽埛';
        
        if (serverSettings.cf_turnstile_enabled && serverSettings.cf_turnstile_site_key) {
            if (turnstileContainer) turnstileContainer.style.display = 'flex';
            if (window.turnstile) {
                turnstileToken = '';
                if (turnstileWidgetId !== null) {
                    turnstile.reset(turnstileWidgetId);
                } else {
                    try {
                        turnstileWidgetId = turnstile.render('#cf-turnstile-container', {
                            sitekey: serverSettings.cf_turnstile_site_key,
                            callback: function(token) {
                                turnstileToken = token;
                            }
                        });
                    } catch (e) {
                        console.error("Turnstile render error:", e);
                    }
                }
            }
        } else {
            if (turnstileContainer) turnstileContainer.style.display = 'none';
        }
    } else {
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
        title.innerText = 'TriNet DNS';
        desc.innerText = '涓夌綉鏅鸿兘瑙ｆ瀽鎺у埗鍙?;
        if (turnstileContainer) turnstileContainer.style.display = 'none';
    }
}

// 鎻愪氦鐧诲綍琛ㄥ崟
async function handleLoginSubmit(event) {
    event.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (res.ok) {
            const data = await res.json();
            localStorage.setItem('trinet_token', data.token);
            localStorage.setItem('trinet_role', data.role || 'user'); // 淇濆瓨 role 瀛楁
            checkLogin();
        } else {
            const data = await res.json();
            alert(data.error || '鐧诲綍澶辫触锛岃妫€鏌ョ敤鎴峰悕 and 瀵嗙爜');
        }
    } catch (err) {
        alert('鐧诲綍澶辫触锛屾棤娉曡繛鎺ュ埌鏈嶅姟鍣?);
    }
}

// 鎻愪氦娉ㄥ唽琛ㄥ崟
async function handleRegisterSubmit(event) {
    event.preventDefault();
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value.trim();
    const confirm = document.getElementById('register-confirm').value.trim();

    if (password !== confirm) {
        alert('涓ゆ杈撳叆鐨勫瘑鐮佷笉涓€鑷达紒');
        return;
    }

    if (serverSettings.cf_turnstile_enabled && !turnstileToken) {
        alert('璇峰厛瀹屾垚浜烘満韬唤楠岃瘉锛?);
        return;
    }

    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, cf_token: turnstileToken })
        });

        const data = await res.json();
        if (res.ok) {
            alert('娉ㄥ唽鎴愬姛锛岃浣跨敤璇ヨ处鍙风櫥褰曪紒');
            toggleLoginReg(false);
        } else {
            alert(data.error || '娉ㄥ唽澶辫触锛岃绋嶅悗閲嶈瘯');
            if (window.turnstile && turnstileWidgetId !== null) {
                turnstile.reset(turnstileWidgetId);
                turnstileToken = '';
            }
        }
    } catch (err) {
        alert('娉ㄥ唽澶辫触锛屾棤娉曡繛鎺ュ埌鏈嶅姟鍣?);
    }
}

// 閫€鍑虹櫥褰?async function logout() {
    const token = localStorage.getItem('trinet_token');
    if (token) {
        try {
            await fetch('/api/logout', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token }
            });
        } catch (err) {
            // 蹇界暐鎶ラ敊
        }
    }
    localStorage.removeItem('trinet_token');
    localStorage.removeItem('trinet_role');
    checkLogin();
}

const passwordModal = document.getElementById('password-modal');
const passwordForm = document.getElementById('password-form');

// 鍒濆鍖栫櫥褰曠姸鎬佹娴?document.addEventListener('DOMContentLoaded', () => {
    checkLogin();
});

function showPasswordModal() {
    passwordForm.reset();
    passwordModal.classList.add('show');
}

function closePasswordModal() {
    passwordModal.classList.remove('show');
}

async function handlePasswordSubmit(event) {
    event.preventDefault();
    const oldPassword = document.getElementById('password-old').value.trim();
    const newPassword = document.getElementById('password-new').value.trim();
    const confirmPassword = document.getElementById('password-confirm').value.trim();

    if (newPassword !== confirmPassword) {
        alert('涓ゆ杈撳叆鐨勬柊瀵嗙爜涓嶄竴鑷达紒');
        return;
    }

    try {
        const res = await fetchAPI('/api/admin/password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                old_password: oldPassword,
                new_password: newPassword
            })
        });

        if (res.ok) {
            alert('瀵嗙爜淇敼鎴愬姛锛岃閲嶆柊鐧诲綍锛?);
            closePasswordModal();
            logout();
        } else {
            const data = await res.json();
            alert('淇敼澶辫触: ' + (data.error || '鏈煡閿欒'));
        }
    } catch (err) {
        alert('淇敼澶辫触: ' + err.message);
    }
}

function toggleSidebar(open) {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar && overlay) {
        if (open) {
            sidebar.classList.add('open');
            overlay.classList.add('active');
        } else {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        }
    }
}

// 鏍囩椤靛垏鎹㈤€昏緫
function switchTab(tabId) {
    // 鍦ㄧЩ鍔ㄧ鐐瑰嚮鑿滃崟璺宠浆鏃惰嚜鍔ㄦ姌鍙犱晶杈规爮
    toggleSidebar(false);

    if (history.replaceState) {
        history.replaceState(null, null, `#${tabId}`);
    }

    // 1. 鍒囨崲鑿滃崟婵€娲荤姸鎬?    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        if (item.getAttribute('href') === `#${tabId}`) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // 2. 鍒囨崲闈㈡澘鏄剧ず鐘舵€?    const panes = document.querySelectorAll('.tab-pane');
    panes.forEach(pane => {
        if (pane.id === `tab-${tabId}`) {
            pane.classList.add('active');
        } else {
            pane.classList.remove('active');
        }
    });

    // 3. 鏇存柊鏍囬鏍忔枃鏈?    const titleMap = {
        'dashboard': '鎺у埗鍙?,
        'records': '瑙ｆ瀽璁板綍',
        'ddns': '鍔ㄦ€?DNS 閰嶇疆',
        'profile': '涓汉涓績',
        'billing': '濂楅璐拱',
        'orders': '璁㈠崟璁板綍',
        'logs': '绯荤粺杩愯鏃ュ織',
        'users': '鐢ㄦ埛绠＄悊鎺у埗鍙?,
        'settings': '绯荤粺绠＄悊璁剧疆'
    };
    document.getElementById('page-title').innerText = titleMap[tabId] || '鎺у埗鍙?;

    // 鍒囨崲鍒板搴旀爣绛炬椂鍒锋柊鏁版嵁
    if (tabId === 'profile') {
        loadUserProfile();
    } else if (tabId === 'records') {
        loadRecords();
    } else if (tabId === 'ddns') {
        loadDDNSTable();
    } else if (tabId === 'users') {
        loadUsersTable();
    } else if (tabId === 'settings') {
        loadSettingsPage();
    } else if (tabId === 'billing') {
        loadBillingPage();
    } else if (tabId === 'orders') {
        loadOrdersTable();
    }
}

// 妯℃€佸脊绐楃鐞?const modalOverlay = document.getElementById('record-modal');
const modalTitle = document.getElementById('modal-title');
const recordForm = document.getElementById('record-form');

let isEditMode = false;

function showAddModal() {
    isEditMode = false;
    modalTitle.innerText = '娣诲姞鍩熷悕瑙ｆ瀽';
    recordForm.reset();
    document.getElementById('input-subdomain').disabled = false;
    document.getElementById('input-domain').disabled = false;
    document.getElementById('select-type').disabled = false;
    document.getElementById('cascader-wrapper-select-isp').removeAttribute('disabled');
    modalOverlay.classList.add('show');
}

function editRecord(subdomain, domain, type, isp, value, ttl) {
    isEditMode = true;
    modalTitle.innerText = '淇敼鍩熷悕瑙ｆ瀽';
    document.getElementById('input-subdomain').value = subdomain;
    document.getElementById('input-subdomain').disabled = true;
    document.getElementById('input-domain').value = domain;
    document.getElementById('input-domain').disabled = true;
    document.getElementById('select-type').value = type;
    document.getElementById('select-type').disabled = true;
    document.getElementById('select-isp').value = isp; if (typeof setCascaderValue === 'function') setCascaderValue('select-isp', isp);
    document.getElementById('cascader-wrapper-select-isp').setAttribute('disabled', 'true');
    document.getElementById('input-value').value = value;
    document.getElementById('input-ttl').value = ttl || 60;
    modalOverlay.classList.add('show');
}

function closeModal() {
    modalOverlay.classList.remove('show');
}

// 瀛樺偍鍏ㄥ眬鐘舵€?let globalData = { domains: {}, tokens: {} };

// 浠?API 鍔犺浇瑙ｆ瀽璁板綍骞舵洿鏂伴〉闈?async function loadRecords() {
    try {
        const res = await fetchAPI('/api/records');
        if (!res.ok) throw new Error('鏃犳硶杩炴帴鍒?API');
        globalData = await res.json();
        
        renderRecordsTable(globalData);
        updateDashboardStats(globalData);
        loadSysStats();
        loadDDNSTable();
    } catch (err) {
        console.error('鍔犺浇璁板綍澶辫触:', err);
    }
}

// 娓叉煋瑙ｆ瀽琛ㄦ牸
function renderRecordsTable(data) {
    const tbody = document.getElementById('records-list');
    tbody.innerHTML = '';

    if (!data.domains || Object.keys(data.domains).length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-light)">鏆傛棤瑙ｆ瀽璁板綍锛岃鐐瑰嚮宸︿笂瑙掓坊鍔?/td></tr>';
        return;
    }

    const ispNameMap = {
        'ct': '鐢典俊 (CT)',
        'cu': '鑱旈€?(CU)',
        'cm': '绉诲姩 (CM)',
        'def': '榛樿 (DEF)'
    };

    for (const [domainName, domainObj] of Object.entries(data.domains)) {
        if (!domainObj.records) continue;

        for (const [key, records] of Object.entries(domainObj.records)) {
            if (!records || records.length === 0) continue;

            // records 鏁扮粍鍖呭惈鍚屼竴涓瓙鍩熷悕銆佸悓绫诲瀷涓嬬殑澶氭潯绾胯矾瑙ｆ瀽
            records.forEach((rec, index) => {
                const tr = document.createElement('tr');
                
                // 绗竴琛岄渶瑕佸悎骞舵樉绀哄瓙鍩熷悕銆佷富鍩熷悕銆佺被鍨?                if (index === 0) {
                    const rowSpan = records.length;
                    
                    const tdSub = document.createElement('td');
                    tdSub.rowSpan = rowSpan;
                    tdSub.className = 'bold font-mono';
                    tdSub.textContent = rec.subdomain;
                    tr.appendChild(tdSub);

                    const tdDom = document.createElement('td');
                    tdDom.rowSpan = rowSpan;
                    tdDom.className = 'font-mono';
                    tdDom.textContent = domainName;
                    tr.appendChild(tdDom);

                    const tdType = document.createElement('td');
                    tdType.rowSpan = rowSpan;
                    tdType.innerHTML = `<span class="badge badge-type">${rec.type}</span>`;
                    tr.appendChild(tdType);
                }

                // 绾胯矾
                const tdISP = document.createElement('td');
                tdISP.innerHTML = `<span class="isp-dot ${rec.isp}"></span>${ispNameMap[rec.isp] || rec.isp}`;
                tr.appendChild(tdISP);

                // 璁板綍鍊?(鍚堝苟涓洪€楀彿鍒嗛殧瀛楃涓插睍绀?
                const tdVal = document.createElement('td');
                tdVal.className = 'font-mono';
                tdVal.textContent = rec.values ? rec.values.join(', ') : '';
                tr.appendChild(tdVal);

                // TTL
                const tdTTL = document.createElement('td');
                tdTTL.className = 'font-mono';
                tdTTL.textContent = rec.ttl;
                tr.appendChild(tdTTL);

                // 鎿嶄綔
                const tdOps = document.createElement('td');
                const valStr = rec.values ? rec.values[0] : '';
                
                tdOps.innerHTML = `
                    <button class="btn btn-text" onclick="editRecord('${rec.subdomain}', '${domainName}', '${rec.type}', '${rec.isp}', '${valStr}', ${rec.ttl})">缂栬緫</button>
                    <button class="btn btn-text danger" onclick="deleteRecord('${rec.subdomain}', '${domainName}', '${rec.type}', '${rec.isp}')">鍒犻櫎</button>
                `;
                tr.appendChild(tdOps);

                // 璁剧疆绾挎潯绫诲埆浼樺寲
                if (index === 0) {
                    tr.className = 'record-group-start';
                }
                if (index === records.length - 1) {
                    tr.className = 'record-group-end';
                }

                tbody.appendChild(tr);
            });
        }
    }
}

// 娓叉煋 DDNS 琛ㄦ牸 (鐙珛鍚?API 鑾峰彇鏈€鏂扮殑鍙潬鏁版嵁)
async function loadDDNSTable() {
    const tbody = document.querySelector('#tab-ddns tbody');
    if (!tbody) return;

    try {
        const res = await fetchAPI('/api/ddns/token?t=' + Date.now());
        if (!res.ok) throw new Error('鏃犳硶杩炴帴鍒?Token API');
        const data = await res.json();

        tbody.innerHTML = '';
        const tokens = data.tokens || {};
        if (Object.keys(tokens).length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-light)">鏆傛棤鍔ㄦ€?DNS 閰嶇疆</td></tr>';
            return;
        }

        const ispNameMap = {
            'ct': '鐢典俊 (CT)',
            'cu': '鑱旈€?(CU)',
            'cm': '绉诲姩 (CM)',
            'def': '榛樿 (DEF)'
        };

        for (const [token, target] of Object.entries(tokens)) {
            const lastIdx = target.lastIndexOf('_');
            let fqdn = target;
            let isp = 'def';
            if (lastIdx > 0) {
                fqdn = target.substring(0, lastIdx);
                isp = target.substring(lastIdx + 1);
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="font-mono">${escapeHTML(fqdn)}</td>
                <td><span class="isp-dot ${isp}"></span>${ispNameMap[isp] || isp}</td>
                <td class="font-mono">
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span style="font-size: 0.85rem; background: rgba(0,0,0,0.05); padding: 2px 8px; border-radius: 4px; font-weight: 600; font-family: monospace;">${escapeHTML(token)}</span>
                        <button class="btn btn-outline" style="padding: 2px 8px; font-size: 0.75rem; white-space: nowrap;" onclick="copyTextToClipboard('${token}')">馃搵 澶嶅埗 Token</button>
                    </div>
                </td>
                <td>-</td>
                <td>
                    <button class="btn btn-text danger" onclick="deleteToken('${token}')">鍒犻櫎</button>
                </td>
            `;
            tbody.appendChild(tr);
        }
    } catch (err) {
        console.error('鍔犺浇 DDNS 琛ㄦ牸澶辫触:', err);
    }
}

const ddnsModal = document.getElementById('ddns-modal');
const ddnsForm = document.getElementById('ddns-form');

function generateToken() {
    ddnsForm.reset();
    ddnsModal.classList.add('show');
}

function closeDdnsModal() {
    ddnsModal.classList.remove('show');
}

async function saveDdnsToken(event) {
    event.preventDefault();
    const fqdn = document.getElementById('ddns-input-fqdn').value.trim();
    const isp = document.getElementById('ddns-select-isp').value;

    try {
        const res = await fetchAPI('/api/ddns/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fqdn, isp })
        });

        if (res.ok) {
            const data = await res.json();
            alert(`Token 鐢熸垚鎴愬姛!\nToken 鍊? ${data.token}\n璇峰姟蹇呭鍒朵繚瀛樻 Token锛屽叧闂悗灏嗘棤娉曞啀娆℃煡鐪嬶紒`);
            closeDdnsModal();
            loadDDNSTable();
            loadRecords();
        } else {
            const data = await res.json();
            alert('鐢熸垚澶辫触: ' + (data.error || '鏈煡閿欒'));
        }
    } catch (err) {
        alert('鐢熸垚澶辫触: ' + err.message);
    }
}

async function deleteToken(token) {
    if (!confirm('纭瑕佸垹闄ゆ DDNS Token 鍚楋紵瀵瑰簲鐨?DDNS 璁惧灏嗘棤娉曞啀杩涜鏇存柊銆?)) {
        return;
    }

    try {
        const res = await fetchAPI(`/api/ddns/token?token=${encodeURIComponent(token)}`, {
            method: 'DELETE'
        });

        if (res.ok) {
            alert('Token 鍒犻櫎鎴愬姛');
            loadDDNSTable();
            loadRecords();
        } else {
            const data = await res.json();
            alert('鍒犻櫎澶辫触: ' + (data.error || '鏈煡閿欒'));
        }
    } catch (err) {
        alert('鍒犻櫎澶辫触: ' + err.message);
    }
}

// 淇濆瓨瑙ｆ瀽璁板綍 (鏂板缓/淇敼)
async function saveRecord(event) {
    event.preventDefault();
    
    const subdomain = document.getElementById('input-subdomain').value.trim();
    const domain = document.getElementById('input-domain').value.trim();
    const qtype = document.getElementById('select-type').value;
    const isp = document.getElementById('select-isp').value;
    const value = document.getElementById('input-value').value.trim();
    const ttl = parseInt(document.getElementById('input-ttl').value);

    const payload = {
        domain,
        subdomain: subdomain === '' ? '@' : subdomain,
        type: qtype,
        isp,
        values: [value],
        ttl
    };

    try {
        const res = await fetchAPI('/api/records', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            closeModal();
            loadRecords();
        } else {
            const errData = await res.json();
            alert('淇濆瓨澶辫触: ' + errData.error);
        }
    } catch (err) {
        alert('缃戠粶璇锋眰澶辫触');
    }
}

// 鍒犻櫎瑙ｆ瀽璁板綍
async function deleteRecord(subdomain, domain, type, isp) {
    if (!confirm(`纭畾瑕佸垹闄?${subdomain}.${domain} (${type} - ${isp}) 鐨勮В鏋愯褰曞悧锛焋)) {
        return;
    }

    try {
        const url = `/api/records?domain=${encodeURIComponent(domain)}&subdomain=${encodeURIComponent(subdomain)}&type=${encodeURIComponent(type)}&isp=${encodeURIComponent(isp)}`;
        const res = await fetchAPI(url, { method: 'DELETE' });
        if (res.ok) {
            loadRecords();
        } else {
            alert('鍒犻櫎澶辫触');
        }
    } catch (err) {
        alert('缃戠粶璇锋眰澶辫触');
    }
}

// 鏇存柊棣栭〉缁熻鍗＄墖
function updateDashboardStats(data) {
    let domainCount = 0;
    let lineCount = 0;
    
    if (data.domains) {
        domainCount = Object.keys(data.domains).length;
        for (const dom of Object.values(data.domains)) {
            if (dom.records) {
                for (const list of Object.values(dom.records)) {
                    lineCount += list.length;
                }
            }
        }
    }

    // 鍔ㄦ€佹洿鏂伴〉闈笂鐨勬寚鏍?    const cards = document.querySelectorAll('.card-value');
    if (cards.length >= 2) {
        cards[1].textContent = domainCount;
        const desc = cards[1].nextElementSibling;
        if (desc) desc.textContent = `娲诲姩涓夌綉绾胯矾: ${lineCount} 鏉;
    }
}

// 鑾峰彇骞舵洿鏂扮湡瀹炵郴缁熻祫婧愮姸鎬?async function loadSysStats() {
    try {
        const res = await fetchAPI('/api/sys/stats?t=' + Date.now());
        if (!res.ok) return;
        const stats = await res.json();
        
        // 1. 绯荤粺璐熻浇
        const cards = document.querySelectorAll('.card-value');
        if (cards.length >= 3) {
            cards[2].textContent = stats.uptime;
            const desc = cards[2].nextElementSibling;
            if (desc) {
                desc.textContent = `CPU 鍗犵敤: ${stats.cpu} | 鍐呭瓨: ${stats.memory}`;
            }
        }

        // 鏇存柊 NS 鑺傜偣鏄剧ず
        const nsListEl = document.getElementById('config-ns-list');
        if (nsListEl && stats.ns_nodes) {
            nsListEl.textContent = stats.ns_nodes.split(',').join('\n');
        }

        // 2. 浠婃棩璇锋眰鎬婚噺
        const queryCountEl = document.getElementById('stat-query-count');
        if (queryCountEl && stats.query_count !== undefined) {
            queryCountEl.textContent = stats.query_count.toLocaleString();
            queryCounter = stats.query_count; // 鍚屾褰撳墠鏈湴璁℃暟
        }

        // 3. 涓夌綉瑙ｆ瀽娴侀噺鍒嗗竷姣斾緥
        if (stats.isp_stats) {
            const total = stats.query_count || 0;
            const ct = stats.isp_stats.ct || 0;
            const cu = stats.isp_stats.cu || 0;
            const cm = stats.isp_stats.cm || 0;
            const def = stats.isp_stats.def || 0;

            const ctPct = total > 0 ? ((ct / total) * 100).toFixed(1) : '0.0';
            const cuPct = total > 0 ? ((cu / total) * 100).toFixed(1) : '0.0';
            const cmPct = total > 0 ? ((cm / total) * 100).toFixed(1) : '0.0';
            const defPct = total > 0 ? ((def / total) * 100).toFixed(1) : '0.0';

            const updateISPBar = (isp, pct) => {
                const valEl = document.getElementById(`stat-bar-val-${isp}`);
                const fillEl = document.getElementById(`stat-bar-fill-${isp}`);
                if (valEl) valEl.textContent = `${pct}%`;
                if (fillEl) fillEl.style.width = `${pct}%`;
            };

            updateISPBar('ct', ctPct);
            updateISPBar('cu', cuPct);
            updateISPBar('cm', cmPct);
            updateISPBar('def', defPct);
        }
    } catch (err) {
        console.error('鑾峰彇绯荤粺鐘舵€佸け璐?', err);
    }
}

// 姣?5 绉掕嚜鍔ㄨ疆璇㈡洿鏂扮郴缁熺姸鎬?setInterval(() => {
    const token = localStorage.getItem('trinet_token');
    if (token) {
        loadSysStats();
    }
}, 5000);


let logSource = null;

// 鏃ュ織澶勭悊涓?SSE (Server-Sent Events) 瀹炲鏃ュ織鎺ㄦ祦
function setupLogStream() {
    const logContainer = document.getElementById('log-container');
    if (!logContainer) return;

    if (logSource) {
        logSource.close();
    }

    const token = localStorage.getItem('trinet_token');
    logSource = new EventSource('/api/logs/stream?token=' + encodeURIComponent(token || ''));

    logSource.onmessage = function(event) {
        const msg = event.data;
        const div = document.createElement('div');
        
        // 鍖归厤鏃ュ織绫诲瀷娓叉煋棰滆壊
        if (msg.includes('[SYSTEM]')) {
            div.className = 'log-row info';
        } else if (msg.includes('[QUERY]')) {
            div.className = 'log-row query';
        } else if (msg.includes('[DDNS]')) {
            div.className = 'log-row api';
        } else {
            div.className = 'log-row';
        }

        // 鑾峰彇褰撳墠鏃堕棿鎴?        const now = new Date();
        const timeStr = `[${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}]`;
        
        div.textContent = msg.startsWith('[') ? msg : `${timeStr} ${msg}`;
        logContainer.appendChild(div);

        // 淇濇寔婊氬姩鏉℃帰搴?        logContainer.scrollTop = logContainer.scrollHeight;

        // 濡傛灉鍦?Dashboard锛屼篃鍔ㄦ€佸鍔犫€滆姹傞噺鈥濇暟鍊艰鏁?        if (msg.includes('[QUERY]')) {
            incrementQueryCount();
        }
    };

    logSource.onerror = function() {
        console.log('SSE 杩炴帴鏂紑锛屽皾璇曢噸杩?..');
    };
}

let queryCounter = 0; // 鍩虹鍊硷紝闅?API 鏁版嵁鍚屾
function incrementQueryCount() {
    const valueEl = document.getElementById('stat-query-count');
    if (valueEl) {
        queryCounter++;
        valueEl.textContent = queryCounter.toLocaleString();
    }
}

function clearLogs() {
    const container = document.getElementById('log-container');
    if (container) {
        container.innerHTML = '<div class="log-row info">[' + new Date().toLocaleString() + '] [SYSTEM] 鏈湴鏃ュ織瑙嗗浘宸叉竻绌恒€?/div>';
    }
}

// 椤甸潰鍔犺浇鍏ュ彛
window.addEventListener('DOMContentLoaded', () => {
    checkLogin();
});

// 鑾峰彇骞舵覆鏌撶郴缁熻缃〉闈紙鍖呭惈鎵€鏈夌鐞嗗憳閰嶇疆椤癸級
// 鑾峰彇骞舵覆鏌撶郴缁熻缃〉闈紙鍖呭惈鎵€鏈夌鐞嗗憳閰嶇疆椤癸級
async function loadSettingsPage() {
    try {
        const res = await fetchAPI('/api/admin/settings');
        if (!res.ok) {
            alert('鑾峰彇绯荤粺閰嶇疆澶辫触锛屾偍鍙兘娌℃湁绠＄悊鍛樻潈闄愶紒');
            return;
        }

        const data = await res.json();

        // 1. 璁剧疆鑷湇鍔℃敞鍐屽紑鍏?        const openRegEl = document.getElementById('setting-open-reg');
        if (openRegEl) {
            openRegEl.checked = !!data.open_registration;
        }

        // 2. 璁剧疆 Cloudflare Turnstile 閰嶇疆
        const cfEnabledEl = document.getElementById('setting-cf-enabled');
        if (cfEnabledEl) {
            cfEnabledEl.checked = !!data.cf_turnstile_enabled;
        }
        const cfSiteKeyEl = document.getElementById('setting-cf-site-key');
        if (cfSiteKeyEl) {
            cfSiteKeyEl.value = data.cf_turnstile_site_key || '';
        }
        const cfSecretKeyEl = document.getElementById('setting-cf-secret-key');
        if (cfSecretKeyEl) {
            cfSecretKeyEl.value = data.cf_turnstile_secret_key || '';
        }

        // 3. 璁剧疆鑺傜偣鍚屾淇℃伅
        const syncTokenEl = document.getElementById('setting-sync-token');
        if (syncTokenEl) {
            syncTokenEl.value = data.sync_token || '';
        }
        const syncUrlEl = document.getElementById('setting-sync-url');
        if (syncUrlEl) {
            syncUrlEl.value = `${window.location.protocol}//${window.location.host}/api/sync`;
        }
        const nsNodesEl = document.getElementById('setting-ns-nodes');
        if (nsNodesEl) {
            nsNodesEl.value = data.ns_nodes ? data.ns_nodes.split(',').join('\n') : '';
        }

        // 3.5 璁剧疆 Cloudflare 浼橀€?IP 鑷姩鍚屾閰嶇疆
        const cfBestEnabledEl = document.getElementById('setting-cf-best-enabled');
        if (cfBestEnabledEl) {
            cfBestEnabledEl.checked = data.cf_best_enabled === 'true' || data.cf_best_enabled === true;
        }
        const cfBestDomainEl = document.getElementById('setting-cf-best-domain');
        if (cfBestDomainEl) {
            cfBestDomainEl.value = data.cf_best_domain || '';
        }
        const cfBestIntervalEl = document.getElementById('setting-cf-best-interval');
        if (cfBestIntervalEl) {
            cfBestIntervalEl.value = data.cf_best_interval || '30';
        }
        const cfBestApiUrlEl = document.getElementById('setting-cf-best-api-url');
        if (cfBestApiUrlEl) {
            cfBestApiUrlEl.value = data.cf_best_api_url || 'https://jkapi.com/api/cf_best?server=1&type=v4';
        }

        // 4. 璁剧疆鍩熷悕濂楅閰嶇疆淇℃伅
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val !== undefined ? val : '';
        };
        setVal('setting-plan-free-limit', data.plan_free_domain_limit);
        
        setVal('setting-plan-junior-name', data.plan_junior_name);
        setVal('setting-plan-junior-limit', data.plan_junior_domain_limit);
        setVal('setting-plan-junior-monthly', data.plan_junior_price_monthly);
        setVal('setting-plan-junior-quarterly', data.plan_junior_price_quarterly);
        setVal('setting-plan-junior-semiannually', data.plan_junior_price_semiannually);
        setVal('setting-plan-junior-annually', data.plan_junior_price_annually);

        setVal('setting-plan-intermediate-name', data.plan_intermediate_name);
        setVal('setting-plan-intermediate-limit', data.plan_intermediate_domain_limit);
        setVal('setting-plan-intermediate-monthly', data.plan_intermediate_price_monthly);
        setVal('setting-plan-intermediate-quarterly', data.plan_intermediate_price_quarterly);
        setVal('setting-plan-intermediate-semiannually', data.plan_intermediate_price_semiannually);
        setVal('setting-plan-intermediate-annually', data.plan_intermediate_price_annually);

        setVal('setting-plan-senior-name', data.plan_senior_name);
        setVal('setting-plan-senior-limit', data.plan_senior_domain_limit);
        setVal('setting-plan-senior-monthly', data.plan_senior_price_monthly);
        setVal('setting-plan-senior-quarterly', data.plan_senior_price_quarterly);
        setVal('setting-plan-senior-semiannually', data.plan_senior_price_semiannually);
        setVal('setting-plan-senior-annually', data.plan_senior_price_annually);

        // 5. 璁剧疆鏀粯閰嶇疆淇℃伅
        setVal('setting-epay-url', data.epay_api_url);
        setVal('setting-epay-pid', data.epay_partner_id);
        setVal('setting-epay-key', data.epay_secret_key);

        setVal('setting-mgate-url', data.mgate_api_url);
        setVal('setting-mgate-appid', data.mgate_app_id);
        setVal('setting-mgate-key', data.mgate_secret_key);

        setVal('setting-usdt-address', data.usdt_trc20_address);
        setVal('setting-usdt-rate', data.usdt_cny_rate);

    } catch (err) {
        console.error('鍔犺浇璁剧疆椤甸潰澶辫触:', err);
    }
}

// 淇濆瓨 NS 瑙ｆ瀽鑺傜偣
async function saveNSNodes(event) {
    event.preventDefault();
    const rawVal = document.getElementById('setting-ns-nodes').value.trim();
    // 杞崲涓洪€楀彿鍒嗛殧
    const ns_nodes = rawVal ? rawVal.split('\n').map(s => s.trim()).filter(s => s).join(',') : '';

    try {
        const res = await fetchAPI('/api/admin/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ns_nodes })
        });
        if (res.ok) {
            alert('NS 瑙ｆ瀽鑺傜偣淇濆瓨鎴愬姛锛?);
            loadSettingsPage();
        } else {
            const data = await res.json();
            alert('淇濆瓨澶辫触: ' + (data.error || '鏈煡閿欒'));
        }
    } catch (err) {
        alert('淇濆瓨澶辫触: ' + err.message);
    }
}

// 淇濆瓨濂楅涓庤祫璐硅缃?async function savePlanSettings(event) {
    event.preventDefault();
    const getVal = (id) => document.getElementById(id).value.trim();
    const getFloatVal = (id) => parseFloat(document.getElementById(id).value) || 0;
    const getIntVal = (id) => parseInt(document.getElementById(id).value) || 0;

    const payload = {
        plan_free_domain_limit: getIntVal('setting-plan-free-limit'),
        
        plan_junior_name: getVal('setting-plan-junior-name'),
        plan_junior_domain_limit: getIntVal('setting-plan-junior-limit'),
        plan_junior_price_monthly: getFloatVal('setting-plan-junior-monthly'),
        plan_junior_price_quarterly: getFloatVal('setting-plan-junior-quarterly'),
        plan_junior_price_semiannually: getFloatVal('setting-plan-junior-semiannually'),
        plan_junior_price_annually: getFloatVal('setting-plan-junior-annually'),

        plan_intermediate_name: getVal('setting-plan-intermediate-name'),
        plan_intermediate_domain_limit: getIntVal('setting-plan-intermediate-limit'),
        plan_intermediate_price_monthly: getFloatVal('setting-plan-intermediate-monthly'),
        plan_intermediate_price_quarterly: getFloatVal('setting-plan-intermediate-quarterly'),
        plan_intermediate_price_semiannually: getFloatVal('setting-plan-intermediate-semiannually'),
        plan_intermediate_price_annually: getFloatVal('setting-plan-intermediate-annually'),

        plan_senior_name: getVal('setting-plan-senior-name'),
        plan_senior_domain_limit: getIntVal('setting-plan-senior-limit'),
        plan_senior_price_monthly: getFloatVal('setting-plan-senior-monthly'),
        plan_senior_price_quarterly: getFloatVal('setting-plan-senior-quarterly'),
        plan_senior_price_semiannually: getFloatVal('setting-plan-senior-semiannually'),
        plan_senior_price_annually: getFloatVal('setting-plan-senior-annually')
    };

    try {
        const res = await fetchAPI('/api/admin/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            alert('鍩熷悕濂楅涓庤祫璐硅缃繚瀛樻垚鍔燂紒');
            loadSettingsPage();
        } else {
            const data = await res.json();
            alert('淇濆瓨澶辫触: ' + (data.error || '鏈煡閿欒'));
        }
    } catch (err) {
        alert('淇濆瓨澶辫触: ' + err.message);
    }
}

// 淇濆瓨鏀粯缃戝叧璁剧疆
async function savePaymentSettings(event) {
    event.preventDefault();
    const getVal = (id) => document.getElementById(id).value.trim();
    const getFloatVal = (id) => parseFloat(document.getElementById(id).value) || 0;

    const payload = {
        epay_api_url: getVal('setting-epay-url'),
        epay_partner_id: getVal('setting-epay-pid'),
        epay_secret_key: getVal('setting-epay-key'),

        mgate_api_url: getVal('setting-mgate-url'),
        mgate_app_id: getVal('setting-mgate-appid'),
        mgate_secret_key: getVal('setting-mgate-key'),

        usdt_trc20_address: getVal('setting-usdt-address'),
        usdt_cny_rate: getFloatVal('setting-usdt-rate')
    };

    try {
        const res = await fetchAPI('/api/admin/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            alert('鏀粯缃戝叧涓庢敹娆惧湴鍧€璁剧疆淇濆瓨鎴愬姛锛?);
            loadSettingsPage();
        } else {
            const data = await res.json();
            alert('淇濆瓨澶辫触: ' + (data.error || '鏈煡閿欒'));
        }
    } catch (err) {
        alert('淇濆瓨澶辫触: ' + err.message);
    }
}

// 蹇€熶慨鏀瑰熀纭€閰嶇疆锛堟瘮濡傛敞鍐屽紑鍏炽€侀獙璇佸紑鍏筹級
async function updateBasicSetting(key, enabled) {
    try {
        const payload = {};
        payload[key] = enabled;

        const res = await fetchAPI('/api/admin/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const data = await res.json();
            let desc = '';
            if (key === 'open_registration') desc = '鑷湇鍔＄敤鎴锋敞鍐?;
            if (key === 'cf_turnstile_enabled') desc = 'Cloudflare Turnstile 楠岃瘉淇濇姢';
            if (key === 'cf_best_enabled') desc = 'Cloudflare 涓夌綉浼橀€?IP 鑷姩鏇存柊';
            alert(`宸叉垚鍔?{enabled ? '寮€鍚? : '鍏抽棴'} ${desc} 鍔熻兘锛乣);
        } else {
            const data = await res.json();
            alert('淇敼閰嶇疆澶辫触: ' + (data.error || '鏈煡閿欒'));
            // 鎭㈠ UI 鐘舵€?            loadSettingsPage();
        }
    } catch (err) {
        alert('淇敼閰嶇疆澶辫触: ' + err.message);
        loadSettingsPage();
    }
}

// 淇濆瓨 Cloudflare 浼橀€夊悓姝ヨ缃?async function saveCFBestSettings(event) {
    event.preventDefault();
    const domain = document.getElementById('setting-cf-best-domain').value.trim();
    const interval = document.getElementById('setting-cf-best-interval').value;
    const apiUrl = document.getElementById('setting-cf-best-api-url').value.trim();

    const payload = {
        cf_best_domain: domain,
        cf_best_interval: interval,
        cf_best_api_url: apiUrl
    };

    try {
        const res = await fetchAPI('/api/admin/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            alert('浼橀€夊悓姝ラ厤缃繚瀛樻垚鍔燂紒');
            loadSettingsPage();
        } else {
            const data = await res.json();
            alert('淇濆瓨澶辫触: ' + (data.error || '鏈煡閿欒'));
        }
    } catch (err) {
        alert('淇濆瓨澶辫触: ' + err.message);
    }
}

// 淇濆瓨 Turnstile Site Key & Secret Key
async function saveTurnstileKeys(event) {
    event.preventDefault();
    const siteKey = document.getElementById('setting-cf-site-key').value.trim();
    const secretKey = document.getElementById('setting-cf-secret-key').value.trim();

    try {
        const res = await fetchAPI('/api/admin/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cf_turnstile_site_key: siteKey,
                cf_turnstile_secret_key: secretKey
            })
        });

        if (res.ok) {
            alert('Cloudflare Turnstile 瀵嗛挜淇濆瓨鎴愬姛锛?);
            loadSettingsPage();
        } else {
            const data = await res.json();
            alert('淇濆瓨澶辫触: ' + (data.error || '鏈煡閿欒'));
        }
    } catch (err) {
        alert('淇濆瓨澶辫触: ' + err.message);
    }
}

// 杈呭姪澶嶅埗鏂囨湰宸ュ叿
function copyToClipboard(inputId) {
    const inputEl = document.getElementById(inputId);
    if (!inputEl) return;
    
    inputEl.select();
    inputEl.setSelectionRange(0, 99999); // 閫傞厤鎵嬫満绔?
    try {
        navigator.clipboard.writeText(inputEl.value);
        alert('宸叉垚鍔熷鍒跺埌鍓创鏉匡紒');
    } catch (err) {
        // 闄嶇骇浣跨敤 execCommand
        try {
            document.execCommand('copy');
            alert('宸叉垚鍔熷鍒跺埌鍓创鏉匡紒');
        } catch (e) {
            alert('澶嶅埗澶辫触锛岃鎵嬪姩閫変腑骞跺鍒躲€?);
        }
    }
}

// 璐㈠姟涓庤处鍗曞椁愪腑蹇冨垵濮嬪寲涓庡姞杞?async function loadBillingPage() {
    try {
        const res = await fetchAPI('/api/user/billing');
        if (!res.ok) {
            alert('鑾峰彇璐﹀崟淇℃伅澶辫触锛岃绋嶅悗閲嶈瘯');
            return;
        }

        const data = await res.json();

        // 1. 娓叉煋褰撳墠濂楅涓庨厤棰濅俊鎭?        const planNameMap = {
            'free': '鍏嶈垂鐗?,
            'junior': '鍒濈骇濂楅',
            'intermediate': '涓骇濂楅',
            'senior': '楂樼骇濂楅'
        };

        const currentPlan = planNameMap[data.plan] || data.plan || '鍏嶈垂鐗?;
        let expiresDesc = '鏃犻檺鏈?;
        if (data.expires_at > 0) {
            expiresDesc = new Date(data.expires_at * 1000).toLocaleString();
            if (Date.now() / 1000 > data.expires_at) {
                expiresDesc += ' (宸插埌鏈?';
            }
        }

        const billingInfoEl = document.getElementById('billing-user-plan-info');
        if (billingInfoEl) {
            billingInfoEl.innerText = `${currentPlan} (${expiresDesc})`;
        }
        const quotaInfoEl = document.getElementById('billing-user-quota-info');
        if (quotaInfoEl) {
            quotaInfoEl.innerText = `鍩熷悕棰濆害: ${data.domain_count} / ${data.domain_limit}`;
        }

        // 2. 娓叉煋鍙喘涔板椁愬崱鐗?        const container = document.getElementById('billing-plans-container');
        if (!container) return;
        container.innerHTML = '';

        if (!data.plans || data.plans.length === 0) {
            container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px 0;">绯荤粺鏆傛棤閰嶇疆璁¤垂濂楅銆?/div>';
            return;
        }

        data.plans.forEach(p => {
            // 鏋勯€犺喘涔板椁愬崱鐗?HTML
            const card = document.createElement('div');
            card.className = 'card';
            card.style = 'padding: 24px; display: flex; flex-direction: column; justify-content: space-between; border-top: 4px solid var(--primary-color); position: relative;';

            // 鏄惁褰撳墠濂楅
            if (data.plan === p.id) {
                const badge = document.createElement('div');
                badge.innerText = '褰撳墠浣跨敤涓?;
                badge.style = 'position: absolute; top: 12px; right: 12px; font-size: 0.75rem; background: var(--primary-color); color: #fff; padding: 2px 8px; border-radius: 4px; font-weight: 600;';
                card.appendChild(badge);
            }

            // 浠锋牸 cycle 閫夐」 select
            let cycleSelectOptions = '';
            const cycleNames = {
                'monthly': '鎸夋湀浠?,
                'quarterly': '鎸夊浠?,
                'semiannually': '姣忓崐骞翠粯',
                'annually': '鎸夊勾浠?
            };
            const cycleMonths = {
                'monthly': '/鏈?,
                'quarterly': '/瀛?,
                'semiannually': '/鍗婂勾',
                'annually': '/骞?
            };

            // 杩囨护鏀寔鐨勫懆鏈熶环鏍硷紝榛樿鏄剧ず绗竴涓?(鎸夋湀浠樹紭鍏?
            let defaultCycle = '';
            const cycleKeys = ['monthly', 'quarterly', 'semiannually', 'annually'];
            for (let c of cycleKeys) {
                if (p.prices[c] !== undefined && parseFloat(p.prices[c]) >= 0) {
                    if (!defaultCycle) defaultCycle = c;
                    cycleSelectOptions += `<option value="${c}" data-price="${p.prices[c]}">${cycleNames[c]} - 锟?{p.prices[c]}${cycleMonths[c]}</option>`;
                }
            }

            // 鏋勫缓鏀粯鎸夐挳锛岄粯璁ゆ坊鍔犻挶鍖呬綑棰濅紭鍏堟墸鍑忔敮浠?            let payButtonsHTML = `<button class="btn btn-primary" style="margin-top: 12px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border: none; font-weight: 600;" onclick="placeOrder('${p.id}', '${p.id}-cycle-select', 'balance', '')">
                馃挵 閽卞寘浣欓鏀粯 (褰撳墠浣欓: 锟?{(data.balance || 0).toFixed(2)})
            </button>`;

            if (data.payment_methods) {
                if (data.payment_methods.epay) {
                    payButtonsHTML += `<button class="btn btn-primary" style="margin-top: 8px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;" onclick="placeOrder('${p.id}', '${p.id}-cycle-select', 'epay', '')">
                        馃挸 鏄撴敮浠樿仛鍚堟敹閾跺彴
                    </button>
                    <div style="display: flex; gap: 8px; margin-top: 6px;">
                        <button class="btn btn-outline" style="flex: 1; padding: 6px; font-size: 0.85rem;" onclick="placeOrder('${p.id}', '${p.id}-cycle-select', 'epay', 'alipay')">馃挋 鏀粯瀹?/button>
                        <button class="btn btn-outline" style="flex: 1; padding: 6px; font-size: 0.85rem;" onclick="placeOrder('${p.id}', '${p.id}-cycle-select', 'epay', 'wxpay')">馃挌 寰俊鏀粯</button>
                    </div>`;
                }
                if (data.payment_methods.mgate) {
                    payButtonsHTML += `<button class="btn btn-outline" style="margin-top: 8px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;" onclick="placeOrder('${p.id}', '${p.id}-cycle-select', 'mgate')">
                        馃殌 蹇嵎寰俊/鏀粯瀹?(MGate)
                    </button>`;
                }
                if (data.payment_methods.usdt) {
                    payButtonsHTML += `<button class="btn btn-outline" style="margin-top: 8px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; border-color: #26a17b; color: #26a17b;" onclick="placeOrder('${p.id}', '${p.id}-cycle-select', 'usdt')">
                        馃煝 鑷姩閾句笂瀵硅处 (USDT-TRC20)
                    </button>`;
                }
            }

            if (!payButtonsHTML) {
                payButtonsHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; margin-top: 15px;">绯荤粺绠＄悊鍛樻殏鏈厤缃敮浠樼綉鍏炽€?/div>`;
            }

            card.innerHTML += `
                <div>
                    <h3 style="margin: 0; font-size: 1.2rem; color: var(--text-light);">${p.name}</h3>
                    <div style="font-size: 2rem; font-weight: 700; color: var(--primary-color); margin: 16px 0 8px 0;" id="${p.id}-price-display">
                        锟?{p.prices[defaultCycle] || '0'}
                    </div>
                    <ul style="padding-left: 20px; color: var(--text-muted); font-size: 0.9rem; line-height: 1.6; margin-bottom: 20px;">
                        <li>鏀寔鎵樼鍩熷悕鏁帮細<strong>${p.domain_limit}</strong> 涓?/li>
                        <li>鐙珛鏅鸿兘涓夌綉 DNS 瑙ｆ瀽绾胯矾</li>
                        <li>鎻愪緵涓撲笟 DDNS 瀹㈡埛绔姩鎬佹洿鏂板瘑閽?/li>
                        <li>鏋侀€熻В鏋愬搷搴?(姣绾?</li>
                    </ul>
                </div>
                <div>
                    <div class="form-group" style="margin-bottom: 12px;">
                        <label style="font-size: 0.8rem; color: var(--text-muted);">閫夋嫨璁㈤槄缁撶畻鍛ㄦ湡</label>
                        <select id="${p.id}-cycle-select" class="form-control" style="margin-top: 4px;" onchange="updatePriceDisplay('${p.id}', this)">
                            ${cycleSelectOptions}
                        </select>
                    </div>
                    ${payButtonsHTML}
                </div>
            `;
            container.appendChild(card);
        });

    } catch (err) {
        console.error('鍔犺浇璐㈠姟涓績澶辫触:', err);
    }
}

// 褰撶敤鎴峰湪涓嬫媺閫夋嫨鍛ㄦ湡鏃讹紝鏇存柊鍗＄墖浠锋牸澶у瓧鏄剧ず
function updatePriceDisplay(planId, selectEl) {
    const option = selectEl.options[selectEl.selectedIndex];
    const price = option.getAttribute('data-price');
    const priceDisplay = document.getElementById(`${planId}-price-display`);
    if (priceDisplay) {
        priceDisplay.innerText = `锟?{price}`;
    }
}

// 鐢ㄦ埛鍙戣捣璐拱涓嬪崟
async function placeOrder(planId, selectId, method, payType = '') {
    const selectEl = document.getElementById(selectId);
    if (!selectEl) return;
    const cycle = selectEl.value;

    const confirmBuy = confirm(`鎮ㄧ‘璁よ璁㈣喘銆?{planId}銆戝椁愬悧锛焋);
    if (!confirmBuy) return;

    try {
        const res = await fetchAPI('/api/user/billing/order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                plan: planId,
                cycle: cycle,
                payment_method: method,
                pay_type: payType
            })
        });

        const data = await res.json();
        if (!res.ok) {
            if (data.error && data.error.includes('浣欓涓嶈冻')) {
                if (confirm(`${data.error}\n\n鏄惁鐜板湪寮€鍚€愰挶鍖呭厖鍊笺€戯紵`)) {
                    openRechargeModal();
                }
            } else {
                alert('鍒涘缓璁㈠崟澶辫触: ' + (data.error || '鏈煡閿欒'));
            }
            return;
        }

        if (data.paid_via === 'balance' || method === 'balance') {
            alert(data.message || '璐拱鎴愬姛锛佸凡鎴愬姛浣跨敤璐︽埛閽卞寘浣欓鎵ｆ寮€閫氬椁愩€?);
            loadBillingPage();
            return;
        }

        if (method === 'usdt') {
            // 鏄剧ず USDT 杞处楠岃瘉琛ㄥ崟鍗＄墖
            const usdtCard = document.getElementById('usdt-verify-card');
            if (usdtCard) {
                usdtCard.style.display = 'block';
                document.getElementById('usdt-pay-address').innerText = data.usdt_trc20_address;
                document.getElementById('usdt-pay-amount').innerText = data.price_usdt;
                document.getElementById('usdt-verify-order-id').value = data.order_id;
                document.getElementById('usdt-verify-txid').value = '';
                
                // 婊氬姩鍒拌浣嶇疆
                usdtCard.scrollIntoView({ behavior: 'smooth' });
                alert(`璁㈠崟鍒涘缓鎴愬姛锛乗n璇峰悜鍦板潃: ${data.usdt_trc20_address}\n杞处绮剧‘淇濈暀2浣嶇殑 ${data.price_usdt} USDT銆傜劧鍚庡湪姝ら〉闈笅鏂硅緭鍏?TxID 杩涜瀵硅处婵€娲汇€俙);
            }
        } else {
            // Epay or MGate锛屽湪鏂版爣绛鹃〉鎵撳紑鏀粯閾炬帴
            if (data.pay_url) {
                window.open(data.pay_url, '_blank');
            } else {
                alert('璁㈠崟鍒涘缓鎴愬姛锛屼絾鏈幏鍙栧埌鏀粯璺宠浆閾炬帴锛岃鑱旂郴绯荤粺绠＄悊鍛樸€?);
            }
        }

    } catch (err) {
        alert('鍒涘缓璁㈠崟澶辫触: ' + err.message);
    }
}

// 鎻愪氦 USDT 璁㈠崟纭婵€娲?async function verifyUsdtOrder(event) {
    event.preventDefault();
    const orderId = document.getElementById('usdt-verify-order-id').value;
    const txId = document.getElementById('usdt-verify-txid').value.trim();

    if (!orderId || !txId) {
        alert('鍙傛暟涓嶅畬鏁达紝璇烽噸鏂版鏌ヤ笅鍗曘€?);
        return;
    }

    try {
        const res = await fetchAPI('/api/user/billing/order/verify-usdt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                order_id: orderId,
                tx_id: txId
            })
        });

        const data = await res.json();
        if (res.ok) {
            alert('鎭枩锛侀摼涓婂璐﹂獙璇佹垚鍔燂紝鎮ㄧ殑濂楅宸叉垚鍔熸縺娲诲崌绾э紒');
            // 闅愯棌 USDT 琛ㄥ崟
            const usdtCard = document.getElementById('usdt-verify-card');
            if (usdtCard) usdtCard.style.display = 'none';
            // 閲嶆柊鍒锋柊椤甸潰浠ユ洿鏂板椁愮姸鎬?            loadBillingPage();
        } else {
            alert('瀵硅处楠岃瘉澶辫触: ' + (data.error || '鏈煡閿欒'));
        }
    } catch (err) {
        alert('瀵硅处楠岃瘉澶辫触: ' + err.message);
    }
}

// 鍔犺浇涓汉涓績鏁版嵁
async function loadUserProfile() {
    try {
        const res = await fetchAPI('/api/user/profile');
        if (!res.ok) return;
        const data = await res.json();

        // 1. 鐢ㄦ埛缁?Badge
        const roleBadge = document.getElementById('profile-role-badge');
        if (roleBadge) {
            roleBadge.innerText = data.role === 'admin' ? '绠＄悊鍛? : '鏅€氱敤鎴?;
            roleBadge.className = data.role === 'admin' ? 'badge badge-primary' : 'badge';
        }

        // 2. 濂楅鏍囬
        const planNames = {
            'free': '鍏嶈垂鐗?,
            'junior': '鍒濈骇濂楅',
            'intermediate': '涓骇濂楅',
            'senior': '楂樼骇濂楅'
        };
        const planTitle = document.getElementById('profile-plan-title');
        if (planTitle) planTitle.innerText = planNames[data.plan] || data.plan || '鍏嶈垂鐗?;

        // 3. 濂楅鍒版湡鏃堕棿
        const expiresEl = document.getElementById('profile-expires-at');
        if (expiresEl) {
            if (!data.expires_at || data.expires_at === 0) {
                expiresEl.innerText = '鏃犻檺鏈?;
            } else {
                const date = new Date(data.expires_at * 1000);
                expiresEl.innerText = date.getFullYear() + '/' + (date.getMonth() + 1) + '/' + date.getDate() + ' ' +
                    String(date.getHours()).padStart(2, '0') + ':' +
                    String(date.getMinutes()).padStart(2, '0') + ':' +
                    String(date.getSeconds()).padStart(2, '0');
            }
        }

        // 4. 缁垂浠锋牸
        const renewPriceEl = document.getElementById('profile-renew-price');
        if (renewPriceEl) renewPriceEl.innerText = data.renew_price || '0';

        // 5. 鏈€澶ц鍒欐暟 / 鎵樼涓婇檺
        const maxRulesEl = document.getElementById('profile-max-rules');
        if (maxRulesEl) maxRulesEl.innerText = data.domain_limit || 1;

        // 6. 閽卞寘浣欓
        const balanceEl = document.getElementById('profile-balance');
        if (balanceEl) balanceEl.innerText = (data.balance || 0).toFixed(2);

        // 7. Telegram 鍏宠仈
        const tgStatusEl = document.getElementById('profile-tg-status');
        if (tgStatusEl) tgStatusEl.innerText = data.telegram_id ? data.telegram_id : '鏈粦瀹?;

        // 8. 鑷姩缁垂寮€鍏?        const autoRenewToggle = document.getElementById('profile-auto-renew-toggle');
        if (autoRenewToggle) autoRenewToggle.checked = !!data.auto_renew;

    } catch (err) {
        console.error('鍔犺浇涓汉涓績鏁版嵁澶辫触:', err);
    }
}

// 鑷姩缁垂寮€鍏冲垏鎹?async function handleAutoRenewChange(enabled) {
    try {
        const res = await fetchAPI('/api/user/profile/auto-renew', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ auto_renew: enabled })
        });
        if (!res.ok) {
            alert('淇敼鑷姩缁垂鐘舵€佸け璐?);
            loadUserProfile();
        }
    } catch (err) {
        alert('淇敼鑷姩缁垂鐘舵€佸け璐? ' + err.message);
        loadUserProfile();
    }
}

// 涓汉涓績閲嶇疆瀵嗙爜
async function handleProfilePasswordSubmit(e) {
    e.preventDefault();
    const oldPass = document.getElementById('profile-old-pass').value;
    const newPass = document.getElementById('profile-new-pass').value;
    const newPassConfirm = document.getElementById('profile-new-pass-confirm').value;

    if (!oldPass || !newPass || !newPassConfirm) {
        alert('璇疯緭鍏ユ墍鏈夊繀濉」');
        return;
    }

    if (newPass !== newPassConfirm) {
        alert('涓ゆ杈撳叆鐨勬柊瀵嗙爜涓嶄竴鑷达紒');
        return;
    }

    try {
        const res = await fetchAPI('/api/admin/password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ old_password: oldPass, new_password: newPass })
        });
        const data = await res.json();
        if (res.ok) {
            alert('瀵嗙爜閲嶇疆鎴愬姛锛佽閲嶆柊鐧诲綍');
            logout();
        } else {
            alert('淇敼瀵嗙爜澶辫触: ' + (data.error || '鍘熷瘑鐮侀敊璇?));
        }
    } catch (err) {
        alert('淇敼瀵嗙爜澶辫触: ' + err.message);
    }
}

// 杞藉叆璁㈠崟璁板綍琛ㄦ牸
async function loadOrdersTable() {
    const tbody = document.getElementById('orders-table-body');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-light)">璁㈠崟鏁版嵁鍔犺浇涓?..</td></tr>';

    try {
        const res = await fetchAPI('/api/user/orders?t=' + Date.now());
        if (!res.ok) throw new Error('鏃犳硶杩炴帴鍒拌鍗?API');
        const orders = await res.json();

        tbody.innerHTML = '';
        if (!orders || orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-light)">鏆傛棤璁㈠崟璁板綍</td></tr>';
            return;
        }

        const cycleMap = {
            'month': '鍖呮湀',
            'year': '鍖呭勾',
            'forever': '姘镐箙'
        };

        const statusMap = {
            'pending': '<span class="badge" style="background: #fef3c7; color: #d97706;">寰呮敮浠?/span>',
            'paid': '<span class="badge" style="background: #d1fae5; color: #059669;">宸叉敮浠?/span>',
            'failed': '<span class="badge" style="background: #fee2e2; color: #dc2626;">宸插け鏁?/span>'
        };

        orders.forEach(order => {
            const tr = document.createElement('tr');
            
            // 鏍煎紡鍖栧垱寤烘椂闂?            const timeStr = order.created_at ? new Date(order.created_at * 1000).toLocaleString('zh-CN', { hour12: false }) : '-';
            
            tr.innerHTML = `
                <td class="font-mono" style="font-weight: 500;">${escapeHTML(order.order_id)}</td>
                <td>${escapeHTML(order.username || '鐢ㄦ埛' + order.user_id)}</td>
                <td><span class="badge badge-type">${escapeHTML(order.plan === 'free' ? '鍏嶈垂鐗? : order.plan)}</span></td>
                <td>${cycleMap[order.cycle] || order.cycle || '-'}</td>
                <td class="font-mono">${order.price.toFixed(2)} 鍏?/td>
                <td>${escapeHTML(order.payment_method === 'usdt' ? 'USDT-TRC20' : order.payment_method)}</td>
                <td>${statusMap[order.status] || order.status}</td>
                <td class="font-mono" style="font-size: 0.8rem; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHTML(order.tx_id || '')}">
                    ${order.tx_id ? escapeHTML(order.tx_id) : '-'}
                </td>
                <td class="font-mono">${timeStr}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--danger)">鍔犺浇璁㈠崟澶辫触: ${escapeHTML(err.message)}</td></tr>`;
    }
}

// 閽卞寘鍏呭€?Modal 浜や簰
function openRechargeModal() {
    const modal = document.getElementById('recharge-modal');
    if (modal) modal.classList.add('show');
}

function closeRechargeModal() {
    const modal = document.getElementById('recharge-modal');
    if (modal) modal.classList.remove('show');
}

async function submitRecharge(e) {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('recharge-amount').value);
    if (isNaN(amount) || amount < 10.0) {
        alert('鏈€灏忓厖鍊奸噾棰濅负 10 鍏?);
        return;
    }

    const radios = document.getElementsByName('recharge-method');
    let selectedMethod = 'epay-all';
    for (let r of radios) {
        if (r.checked) {
            selectedMethod = r.value;
            break;
        }
    }

    let method = 'epay';
    let payType = '';
    if (selectedMethod === 'epay-all') {
        method = 'epay';
        payType = '';
    } else if (selectedMethod === 'epay-alipay') {
        method = 'epay';
        payType = 'alipay';
    } else if (selectedMethod === 'epay-wxpay') {
        method = 'epay';
        payType = 'wxpay';
    } else if (selectedMethod === 'usdt') {
        method = 'usdt';
    }

    try {
        const res = await fetchAPI('/api/user/billing/order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                plan: 'recharge',
                cycle: 'monthly',
                payment_method: method,
                pay_type: payType,
                amount: amount
            })
        });

        const data = await res.json();
        if (!res.ok) {
            alert('鍒涘缓鍏呭€艰鍗曞け璐? ' + (data.error || '鏈煡閿欒'));
            return;
        }

        closeRechargeModal();

        if (method === 'usdt') {
            switchTab('billing');
            const usdtCard = document.getElementById('usdt-verify-card');
            if (usdtCard) {
                usdtCard.style.display = 'block';
                document.getElementById('usdt-pay-address').innerText = data.usdt_trc20_address;
                document.getElementById('usdt-pay-amount').innerText = data.price_usdt;
                document.getElementById('usdt-verify-order-id').value = data.order_id;
                document.getElementById('usdt-verify-txid').value = '';
                usdtCard.scrollIntoView({ behavior: 'smooth' });
                alert(`鍏呭€艰鍗曞垱寤烘垚鍔燂紒\n璇峰悜鍦板潃: ${data.usdt_trc20_address}\n杞处绮剧‘淇濈暀2浣嶇殑 ${data.price_usdt} USDT銆傝浆璐︽垚鍔熷悗杈撳叆 TxID 杩涜瀵硅处鍒拌处銆俙);
            }
        } else {
            if (data.pay_url) {
                window.open(data.pay_url, '_blank');
            } else {
                alert('鍏呭€艰鍗曞垱寤烘垚鍔燂紝浣嗘湭鑾峰彇鍒版敮浠樿烦杞摼鎺ワ紝璇疯仈绯荤鐞嗗憳銆?);
            }
        }
    } catch (err) {
        alert('鍒涘缓鍏呭€艰鍗曞け璐? ' + err.message);
    }
}

// 绠＄悊鍛樼敤鎴风鐞嗘暟鎹姞杞?async function loadUsersTable() {
    try {
        const res = await fetchAPI('/api/admin/users');
        if (!res.ok) {
            alert('鏃犳硶鑾峰彇鐢ㄦ埛鍒楄〃锛堟棤绠＄悊鍛樻潈闄愶級');
            return;
        }
        const users = await res.json();
        const tbody = document.getElementById('users-table-body');
        if (!tbody) return;

        if (!users || users.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">鏆傛棤娉ㄥ唽鐢ㄦ埛鏁版嵁</td></tr>`;
            return;
        }

        const planNames = {
            'free': '鍏嶈垂鐗?,
            'junior': '鍒濈骇濂楅',
            'intermediate': '涓骇濂楅',
            'senior': '楂樼骇濂楅'
        };

        tbody.innerHTML = users.map(u => {
            let expiresStr = '鏃犻檺鏈?;
            if (u.expires_at && u.expires_at > 0) {
                const d = new Date(u.expires_at * 1000);
                expiresStr = d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
                    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
            }

            const roleBadge = u.role === 'admin' 
                ? `<span class="badge badge-primary">绠＄悊鍛?/span>` 
                : `<span class="badge">鏅€氱敤鎴?/span>`;

            return `
                <tr>
                    <td>${u.id}</td>
                    <td><strong>${escapeHTML(u.username)}</strong></td>
                    <td>${roleBadge}</td>
                    <td>${planNames[u.plan] || u.plan}</td>
                    <td style="font-family: monospace; font-size: 0.85rem;">${expiresStr}</td>
                    <td><strong style="color: var(--primary);">${(u.balance || 0).toFixed(2)}</strong> 鍏?/td>
                    <td>${u.domain_count || 0} 涓?/td>
                    <td>
                        <div style="display: flex; gap: 6px;">
                            <button class="btn btn-outline" style="padding: 2px 8px; font-size: 0.8rem;" onclick="openAdminEditUserModal(${u.id}, '${escapeHTML(u.username)}', '${u.role}', '${u.plan}')">鉁忥笍 缂栬緫</button>
                            ${u.id !== 1 ? `<button class="btn btn-outline danger" style="padding: 2px 8px; font-size: 0.8rem;" onclick="deleteAdminUser(${u.id}, '${escapeHTML(u.username)}')">馃棏锔?鍒犻櫎</button>` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

    } catch (err) {
        console.error('鍔犺浇鐢ㄦ埛鍒楄〃澶辫触:', err);
    }
}

// 鎵撳紑鏂板鐢ㄦ埛 Modal
function openAdminCreateUserModal() {
    document.getElementById('admin-user-modal-title').innerText = '鎵嬪姩鏂板鐢ㄦ埛';
    document.getElementById('admin-user-id').value = '';
    document.getElementById('admin-user-name').value = '';
    document.getElementById('admin-user-name').disabled = false;
    document.getElementById('admin-user-role').value = 'user';
    document.getElementById('admin-user-plan').value = 'free';
    document.getElementById('admin-user-balance-group').style.display = 'none';
    document.getElementById('admin-user-expire-group').style.display = 'none';
    document.getElementById('admin-user-pass').placeholder = '璇疯緭鍏ョ敤鎴峰瘑鐮?;
    document.getElementById('admin-user-pass').required = true;

    const modal = document.getElementById('admin-user-modal');
    if (modal) modal.classList.add('show');
}

// 鎵撳紑缂栬緫鐢ㄦ埛 Modal
function openAdminEditUserModal(id, username, role, plan) {
    document.getElementById('admin-user-modal-title').innerText = `缂栬緫鐢ㄦ埛 [${username}]`;
    document.getElementById('admin-user-id').value = id;
    document.getElementById('admin-user-name').value = username;
    document.getElementById('admin-user-name').disabled = true;
    document.getElementById('admin-user-role').value = role || 'user';
    document.getElementById('admin-user-plan').value = plan || 'free';
    document.getElementById('admin-user-add-balance').value = '0.00';
    document.getElementById('admin-user-balance-group').style.display = 'block';
    document.getElementById('admin-user-expire-group').style.display = 'block';
    document.getElementById('admin-user-expire-select').value = 'keep';
    document.getElementById('admin-user-pass').placeholder = '鑻ヤ笉淇敼瀵嗙爜璇风暀绌?;
    document.getElementById('admin-user-pass').required = false;
    document.getElementById('admin-user-pass').value = '';

    const modal = document.getElementById('admin-user-modal');
    if (modal) modal.classList.add('show');
}

function closeAdminUserModal() {
    const modal = document.getElementById('admin-user-modal');
    if (modal) modal.classList.remove('show');
}

// 淇濆瓨鐢ㄦ埛鍒涘缓/缂栬緫
async function saveAdminUser(e) {
    e.preventDefault();
    const id = document.getElementById('admin-user-id').value;
    const username = document.getElementById('admin-user-name').value;
    const role = document.getElementById('admin-user-role').value;
    const plan = document.getElementById('admin-user-plan').value;
    const newPass = document.getElementById('admin-user-pass').value;

    if (!id) {
        // 鍒涘缓鏂扮敤鎴?        try {
            const res = await fetchAPI('/api/admin/users/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: username,
                    password: newPass,
                    role: role,
                    plan: plan
                })
            });
            const data = await res.json();
            if (res.ok) {
                alert(`鐢ㄦ埛 [${username}] 鍒涘缓鎴愬姛锛乣);
                closeAdminUserModal();
                loadUsersTable();
            } else {
                alert('鍒涘缓鐢ㄦ埛澶辫触: ' + (data.error || '鏈煡閿欒'));
            }
        } catch (err) {
            alert('鍒涘缓鐢ㄦ埛澶辫触: ' + err.message);
        }
    } else {
        // 缂栬緫淇敼宸叉湁鐢ㄦ埛
        const addBalance = parseFloat(document.getElementById('admin-user-add-balance').value) || 0;
        const expireChoice = document.getElementById('admin-user-expire-select').value;
        let expiresAt = -1; // -1 琛ㄧず涓嶄慨鏀?
        if (expireChoice === '0') {
            expiresAt = 0;
        } else if (expireChoice === '+30d') {
            expiresAt = Math.floor(Date.now() / 1000) + (30 * 24 * 3600);
        } else if (expireChoice === '+365d') {
            expiresAt = Math.floor(Date.now() / 1000) + (365 * 24 * 3600);
        }

        try {
            const res = await fetchAPI('/api/admin/users/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: parseInt(id),
                    role: role,
                    plan: plan,
                    expires_at: expiresAt,
                    add_balance: addBalance,
                    new_password: newPass
                })
            });
            const data = await res.json();
            if (res.ok) {
                alert(`鐢ㄦ埛 [${username}] 璁剧疆宸叉洿鏂帮紒`);
                closeAdminUserModal();
                loadUsersTable();
            } else {
                alert('鏇存柊鐢ㄦ埛澶辫触: ' + (data.error || '鏈煡閿欒'));
            }
        } catch (err) {
            alert('鏇存柊鐢ㄦ埛澶辫触: ' + err.message);
        }
    }
}

// 鍒犻櫎鐢ㄦ埛
async function deleteAdminUser(id, username) {
    if (!confirm(`璀﹀憡锛氱‘璁よ鍒犻櫎鐢ㄦ埛 [${username}] 鍙婂叾鎷ユ湁鐨勬墍鏈夎В鏋愯褰曞悧锛熸鎿嶄綔涓嶅彲閫嗭紒`)) return;

    try {
        const res = await fetchAPI('/api/admin/users/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: id })
        });
        const data = await res.json();
        if (res.ok) {
            alert(`鐢ㄦ埛 [${username}] 宸叉垚鍔熷垹闄わ紒`);
            loadUsersTable();
        } else {
            alert('鍒犻櫎澶辫触: ' + (data.error || '鏈煡閿欒'));
        }
    } catch (err) {
        alert('鍒犻櫎澶辫触: ' + err.message);
    }
}

// 鍔ㄦ€佸姞杞借闂€呭缃?鏈満 IP
async function loadVisitorIP() {
    const el = document.getElementById('visitor-ip-display');
    if (!el) return;
    try {
        const res = await fetch('/api/ip');
        if (res.ok) {
            const data = await res.json();
            if (data.ip) {
                el.innerText = `鏈満 IP: ${data.ip}`;
                return;
            }
        }
    } catch (e) {}
    
    try {
        const res = await fetch('https://api.ipify.org?format=json');
        if (res.ok) {
            const data = await res.json();
            if (data.ip) {
                el.innerText = `鏈満 IP: ${data.ip}`;
            }
        }
    } catch (e) {
        el.innerText = `鏈満 IP: 鏈幏鍙朻;
    }
}

// 涓汉涓績涓€閿娇鐢ㄩ挶鍖呬綑棰濇墸娆剧画璐?async function renewProfileWithBalance() {
    if (!confirm('纭瑕佷娇鐢ㄨ处鎴烽挶鍖呬綑棰濆垝鎵?30 澶╂湀璐逛负褰撳墠濂楅寮€閫氱画璐瑰悧锛?)) return;

    try {
        const res = await fetchAPI('/api/user/profile/renew', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            alert(data.message || '缁垂鎴愬姛锛佸凡鎴愬姛浠庤处鎴烽挶鍖呭垝鎵?30 澶?);
            loadUserProfile();
        } else {
            if (data.error && data.error.includes('浣欓涓嶈冻')) {
                if (confirm(`${data.error}\n\n鏄惁鐜板湪寮€鍚€愰挶鍖呭厖鍊笺€戯紵`)) {
                    openRechargeModal();
                }
            } else {
                alert('缁垂澶辫触: ' + (data.error || '鏈煡閿欒'));
            }
        }
    } catch (err) {
        alert('缁垂澶辫触: ' + err.message);
    }
}

