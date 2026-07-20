// HTML 字符安全转义防注入函数
function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 通用文本一键复制工具函数
function copyTextToClipboard(text) {
    if (!text) return;
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
            alert('已成功复制到剪贴板！');
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
        alert('已成功复制到剪贴板！');
    } catch (err) {
        alert('复制失败，请手动复制');
    }
    document.body.removeChild(textArea);
}

function copyCodeContent(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    copyTextToClipboard(el.innerText);
}

// API 请求统一封装，自动注入 Authorization Token 并处理 401 未授权
async function fetchAPI(url, options = {}) {
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
        throw new Error('登录会话已过期，请重新登录');
    }
    return res;
}

// 全局配置与 Turnstile 状态
let serverSettings = { open_registration: false, cf_turnstile_enabled: false, cf_turnstile_site_key: '' };
let turnstileWidgetId = null;
let turnstileToken = '';

// 检查登录状态并切换界面
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

        // 加载访问者 IP
        loadVisitorIP();

        // 若本地角色缓存缺失，自动向后端拉取校准，避免历史会话没有缓存 role 字段导致菜单隐藏
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
                .catch(err => console.error('自动拉取用户角色失败:', err));
        }
        
        // 首屏恢复标签页前先强行加载完整的后端数据
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

// 获取开放注册配置并设置 UI
async function initLoginConfig() {
    try {
        const res = await fetch('/api/login');
        if (res.ok) {
            const data = await res.json();
            serverSettings = data; // 保存全局变量
            const regLink = document.getElementById('reg-link-container');
            if (data.open_registration) {
                regLink.style.display = 'block';
            } else {
                regLink.style.display = 'none';
            }
        }
    } catch (err) {
        console.error('无法载入开放注册配置', err);
    }
}

// 切换登录和注册界面
function toggleLoginReg(showReg) {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const title = document.getElementById('login-box-title');
    const desc = document.getElementById('login-box-desc');
    const turnstileContainer = document.getElementById('cf-turnstile-container');
    
    if (showReg) {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        title.innerText = '用户注册';
        desc.innerText = '创建一个新的 TriNet 解析账户';
        
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
        desc.innerText = '三网智能解析控制台';
        if (turnstileContainer) turnstileContainer.style.display = 'none';
    }
}

// 提交登录表单
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
            localStorage.setItem('trinet_role', data.role || 'user'); // 保存 role 字段
            checkLogin();
        } else {
            const data = await res.json();
            alert(data.error || '登录失败，请检查用户名 and 密码');
        }
    } catch (err) {
        alert('登录失败，无法连接到服务器');
    }
}

// 提交注册表单
async function handleRegisterSubmit(event) {
    event.preventDefault();
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value.trim();
    const confirm = document.getElementById('register-confirm').value.trim();

    if (password !== confirm) {
        alert('两次输入的密码不一致！');
        return;
    }

    if (serverSettings.cf_turnstile_enabled && !turnstileToken) {
        alert('请先完成人机身份验证！');
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
            alert('注册成功，请使用该账号登录！');
            toggleLoginReg(false);
        } else {
            alert(data.error || '注册失败，请稍后重试');
            if (window.turnstile && turnstileWidgetId !== null) {
                turnstile.reset(turnstileWidgetId);
                turnstileToken = '';
            }
        }
    } catch (err) {
        alert('注册失败，无法连接到服务器');
    }
}

// 退出登录
async function logout() {
    const token = localStorage.getItem('trinet_token');
    if (token) {
        try {
            await fetch('/api/logout', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token }
            });
        } catch (err) {
            // 忽略报错
        }
    }
    localStorage.removeItem('trinet_token');
    localStorage.removeItem('trinet_role');
    checkLogin();
}

const passwordModal = document.getElementById('password-modal');
const passwordForm = document.getElementById('password-form');

// 初始化登录状态检测
document.addEventListener('DOMContentLoaded', () => {
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
        alert('两次输入的新密码不一致！');
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
            alert('密码修改成功，请重新登录！');
            closePasswordModal();
            logout();
        } else {
            const data = await res.json();
            alert('修改失败: ' + (data.error || '未知错误'));
        }
    } catch (err) {
        alert('修改失败: ' + err.message);
    }
}

// 标签页切换逻辑
function switchTab(tabId) {
    if (history.replaceState) {
        history.replaceState(null, null, `#${tabId}`);
    }

    // 1. 切换菜单激活状态
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        if (item.getAttribute('href') === `#${tabId}`) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // 2. 切换面板显示状态
    const panes = document.querySelectorAll('.tab-pane');
    panes.forEach(pane => {
        if (pane.id === `tab-${tabId}`) {
            pane.classList.add('active');
        } else {
            pane.classList.remove('active');
        }
    });

    // 3. 更新标题栏文本
    const titleMap = {
        'dashboard': '控制台',
        'records': '解析记录',
        'ddns': '动态 DNS 配置',
        'profile': '个人中心',
        'billing': '套餐购买',
        'logs': '系统运行日志',
        'users': '用户管理控制台',
        'settings': '系统管理设置'
    };
    document.getElementById('page-title').innerText = titleMap[tabId] || '控制台';

    // 切换到对应标签时刷新数据
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
    }
}

// 模态弹窗管理
const modalOverlay = document.getElementById('record-modal');
const modalTitle = document.getElementById('modal-title');
const recordForm = document.getElementById('record-form');

let isEditMode = false;

function showAddModal() {
    isEditMode = false;
    modalTitle.innerText = '添加域名解析';
    recordForm.reset();
    document.getElementById('input-subdomain').disabled = false;
    document.getElementById('input-domain').disabled = false;
    document.getElementById('select-type').disabled = false;
    document.getElementById('select-isp').disabled = false;
    modalOverlay.classList.add('show');
}

function editRecord(subdomain, domain, type, isp, value, ttl) {
    isEditMode = true;
    modalTitle.innerText = '修改域名解析';
    document.getElementById('input-subdomain').value = subdomain;
    document.getElementById('input-subdomain').disabled = true;
    document.getElementById('input-domain').value = domain;
    document.getElementById('input-domain').disabled = true;
    document.getElementById('select-type').value = type;
    document.getElementById('select-type').disabled = true;
    document.getElementById('select-isp').value = isp;
    document.getElementById('select-isp').disabled = true;
    document.getElementById('input-value').value = value;
    document.getElementById('input-ttl').value = ttl || 60;
    modalOverlay.classList.add('show');
}

function closeModal() {
    modalOverlay.classList.remove('show');
}

// 存储全局状态
let globalData = { domains: {}, tokens: {} };

// 从 API 加载解析记录并更新页面
async function loadRecords() {
    try {
        const res = await fetchAPI('/api/records');
        if (!res.ok) throw new Error('无法连接到 API');
        globalData = await res.json();
        
        renderRecordsTable(globalData);
        updateDashboardStats(globalData);
        loadSysStats();
        loadDDNSTable();
    } catch (err) {
        console.error('加载记录失败:', err);
    }
}

// 渲染解析表格
function renderRecordsTable(data) {
    const tbody = document.getElementById('records-list');
    tbody.innerHTML = '';

    if (!data.domains || Object.keys(data.domains).length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-light)">暂无解析记录，请点击左上角添加</td></tr>';
        return;
    }

    const ispNameMap = {
        'ct': '电信 (CT)',
        'cu': '联通 (CU)',
        'cm': '移动 (CM)',
        'def': '默认 (DEF)'
    };

    for (const [domainName, domainObj] of Object.entries(data.domains)) {
        if (!domainObj.records) continue;

        for (const [key, records] of Object.entries(domainObj.records)) {
            if (!records || records.length === 0) continue;

            // records 数组包含同一个子域名、同类型下的多条线路解析
            records.forEach((rec, index) => {
                const tr = document.createElement('tr');
                
                // 第一行需要合并显示子域名、主域名、类型
                if (index === 0) {
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

                // 线路
                const tdISP = document.createElement('td');
                tdISP.innerHTML = `<span class="isp-dot ${rec.isp}"></span>${ispNameMap[rec.isp] || rec.isp}`;
                tr.appendChild(tdISP);

                // 记录值 (合并为逗号分隔字符串展示)
                const tdVal = document.createElement('td');
                tdVal.className = 'font-mono';
                tdVal.textContent = rec.values ? rec.values.join(', ') : '';
                tr.appendChild(tdVal);

                // TTL
                const tdTTL = document.createElement('td');
                tdTTL.className = 'font-mono';
                tdTTL.textContent = rec.ttl;
                tr.appendChild(tdTTL);

                // 操作
                const tdOps = document.createElement('td');
                const valStr = rec.values ? rec.values[0] : '';
                
                tdOps.innerHTML = `
                    <button class="btn btn-text" onclick="editRecord('${rec.subdomain}', '${domainName}', '${rec.type}', '${rec.isp}', '${valStr}', ${rec.ttl})">编辑</button>
                    <button class="btn btn-text danger" onclick="deleteRecord('${rec.subdomain}', '${domainName}', '${rec.type}', '${rec.isp}')">删除</button>
                `;
                tr.appendChild(tdOps);

                // 设置线条类别优化
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

// 渲染 DDNS 表格 (独立向 API 获取最新的可靠数据)
async function loadDDNSTable() {
    const tbody = document.querySelector('#tab-ddns tbody');
    if (!tbody) return;

    try {
        const res = await fetchAPI('/api/ddns/token?t=' + Date.now());
        if (!res.ok) throw new Error('无法连接到 Token API');
        const data = await res.json();

        tbody.innerHTML = '';
        const tokens = data.tokens || {};
        if (Object.keys(tokens).length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-light)">暂无动态 DNS 配置</td></tr>';
            return;
        }

        const ispNameMap = {
            'ct': '电信 (CT)',
            'cu': '联通 (CU)',
            'cm': '移动 (CM)',
            'def': '默认 (DEF)'
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
                        <button class="btn btn-outline" style="padding: 2px 8px; font-size: 0.75rem; white-space: nowrap;" onclick="copyTextToClipboard('${token}')">📋 复制 Token</button>
                    </div>
                </td>
                <td>-</td>
                <td>
                    <button class="btn btn-text danger" onclick="deleteToken('${token}')">删除</button>
                </td>
            `;
            tbody.appendChild(tr);
        }
    } catch (err) {
        console.error('加载 DDNS 表格失败:', err);
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
            alert(`Token 生成成功!\nToken 值: ${data.token}\n请务必复制保存此 Token，关闭后将无法再次查看！`);
            closeDdnsModal();
            loadDDNSTable();
            loadRecords();
        } else {
            const data = await res.json();
            alert('生成失败: ' + (data.error || '未知错误'));
        }
    } catch (err) {
        alert('生成失败: ' + err.message);
    }
}

async function deleteToken(token) {
    if (!confirm('确认要删除此 DDNS Token 吗？对应的 DDNS 设备将无法再进行更新。')) {
        return;
    }

    try {
        const res = await fetchAPI(`/api/ddns/token?token=${encodeURIComponent(token)}`, {
            method: 'DELETE'
        });

        if (res.ok) {
            alert('Token 删除成功');
            loadDDNSTable();
            loadRecords();
        } else {
            const data = await res.json();
            alert('删除失败: ' + (data.error || '未知错误'));
        }
    } catch (err) {
        alert('删除失败: ' + err.message);
    }
}

// 保存解析记录 (新建/修改)
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
            alert('保存失败: ' + errData.error);
        }
    } catch (err) {
        alert('网络请求失败');
    }
}

// 删除解析记录
async function deleteRecord(subdomain, domain, type, isp) {
    if (!confirm(`确定要删除 ${subdomain}.${domain} (${type} - ${isp}) 的解析记录吗？`)) {
        return;
    }

    try {
        const url = `/api/records?domain=${encodeURIComponent(domain)}&subdomain=${encodeURIComponent(subdomain)}&type=${encodeURIComponent(type)}&isp=${encodeURIComponent(isp)}`;
        const res = await fetchAPI(url, { method: 'DELETE' });
        if (res.ok) {
            loadRecords();
        } else {
            alert('删除失败');
        }
    } catch (err) {
        alert('网络请求失败');
    }
}

// 更新首页统计卡片
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

    // 动态更新页面上的指标
    const cards = document.querySelectorAll('.card-value');
    if (cards.length >= 2) {
        cards[1].textContent = domainCount;
        const desc = cards[1].nextElementSibling;
        if (desc) desc.textContent = `活动三网线路: ${lineCount} 条`;
    }
}

// 获取并更新真实系统资源状态
async function loadSysStats() {
    try {
        const res = await fetchAPI('/api/sys/stats?t=' + Date.now());
        if (!res.ok) return;
        const stats = await res.json();
        
        // 1. 系统负载
        const cards = document.querySelectorAll('.card-value');
        if (cards.length >= 3) {
            cards[2].textContent = stats.uptime;
            const desc = cards[2].nextElementSibling;
            if (desc) {
                desc.textContent = `CPU 占用: ${stats.cpu} | 内存: ${stats.memory}`;
            }
        }

        // 更新 NS 节点显示
        const nsListEl = document.getElementById('config-ns-list');
        if (nsListEl && stats.ns_nodes) {
            nsListEl.textContent = stats.ns_nodes.split(',').join('\n');
        }

        // 2. 今日请求总量
        const queryCountEl = document.getElementById('stat-query-count');
        if (queryCountEl && stats.query_count !== undefined) {
            queryCountEl.textContent = stats.query_count.toLocaleString();
            queryCounter = stats.query_count; // 同步当前本地计数
        }

        // 3. 三网解析流量分布比例
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
        console.error('获取系统状态失败:', err);
    }
}

// 每 5 秒自动轮询更新系统状态
setInterval(() => {
    const token = localStorage.getItem('trinet_token');
    if (token) {
        loadSysStats();
    }
}, 5000);


let logSource = null;

// 日志处理与 SSE (Server-Sent Events) 实对日志推流
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
        
        // 匹配日志类型渲染颜色
        if (msg.includes('[SYSTEM]')) {
            div.className = 'log-row info';
        } else if (msg.includes('[QUERY]')) {
            div.className = 'log-row query';
        } else if (msg.includes('[DDNS]')) {
            div.className = 'log-row api';
        } else {
            div.className = 'log-row';
        }

        // 获取当前时间戳
        const now = new Date();
        const timeStr = `[${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}]`;
        
        div.textContent = msg.startsWith('[') ? msg : `${timeStr} ${msg}`;
        logContainer.appendChild(div);

        // 保持滚动条探底
        logContainer.scrollTop = logContainer.scrollHeight;

        // 如果在 Dashboard，也动态增加“请求量”数值计数
        if (msg.includes('[QUERY]')) {
            incrementQueryCount();
        }
    };

    logSource.onerror = function() {
        console.log('SSE 连接断开，尝试重连...');
    };
}

let queryCounter = 0; // 基础值，随 API 数据同步
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
        container.innerHTML = '<div class="log-row info">[' + new Date().toLocaleString() + '] [SYSTEM] 本地日志视图已清空。</div>';
    }
}

// 页面加载入口
window.addEventListener('DOMContentLoaded', () => {
    checkLogin();
});

// 获取并渲染系统设置页面（包含所有管理员配置项）
// 获取并渲染系统设置页面（包含所有管理员配置项）
async function loadSettingsPage() {
    try {
        const res = await fetchAPI('/api/admin/settings');
        if (!res.ok) {
            alert('获取系统配置失败，您可能没有管理员权限！');
            return;
        }

        const data = await res.json();

        // 1. 设置自服务注册开关
        const openRegEl = document.getElementById('setting-open-reg');
        if (openRegEl) {
            openRegEl.checked = !!data.open_registration;
        }

        // 2. 设置 Cloudflare Turnstile 配置
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

        // 3. 设置节点同步信息
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

        // 4. 设置域名套餐配置信息
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

        // 5. 设置支付配置信息
        setVal('setting-epay-url', data.epay_api_url);
        setVal('setting-epay-pid', data.epay_partner_id);
        setVal('setting-epay-key', data.epay_secret_key);

        setVal('setting-mgate-url', data.mgate_api_url);
        setVal('setting-mgate-appid', data.mgate_app_id);
        setVal('setting-mgate-key', data.mgate_secret_key);

        setVal('setting-usdt-address', data.usdt_trc20_address);
        setVal('setting-usdt-rate', data.usdt_cny_rate);

    } catch (err) {
        console.error('加载设置页面失败:', err);
    }
}

// 保存 NS 解析节点
async function saveNSNodes(event) {
    event.preventDefault();
    const rawVal = document.getElementById('setting-ns-nodes').value.trim();
    // 转换为逗号分隔
    const ns_nodes = rawVal ? rawVal.split('\n').map(s => s.trim()).filter(s => s).join(',') : '';

    try {
        const res = await fetchAPI('/api/admin/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ns_nodes })
        });
        if (res.ok) {
            alert('NS 解析节点保存成功！');
            loadSettingsPage();
        } else {
            const data = await res.json();
            alert('保存失败: ' + (data.error || '未知错误'));
        }
    } catch (err) {
        alert('保存失败: ' + err.message);
    }
}

// 保存套餐与资费设置
async function savePlanSettings(event) {
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
            alert('域名套餐与资费设置保存成功！');
            loadSettingsPage();
        } else {
            const data = await res.json();
            alert('保存失败: ' + (data.error || '未知错误'));
        }
    } catch (err) {
        alert('保存失败: ' + err.message);
    }
}

// 保存支付网关设置
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
            alert('支付网关与收款地址设置保存成功！');
            loadSettingsPage();
        } else {
            const data = await res.json();
            alert('保存失败: ' + (data.error || '未知错误'));
        }
    } catch (err) {
        alert('保存失败: ' + err.message);
    }
}

// 快速修改基础配置（比如注册开关、验证开关）
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
            if (key === 'open_registration') desc = '自服务用户注册';
            if (key === 'cf_turnstile_enabled') desc = 'Cloudflare Turnstile 验证保护';
            alert(`已成功${enabled ? '开启' : '关闭'} ${desc} 功能！`);
        } else {
            const data = await res.json();
            alert('修改配置失败: ' + (data.error || '未知错误'));
            // 恢复 UI 状态
            loadSettingsPage();
        }
    } catch (err) {
        alert('修改配置失败: ' + err.message);
        loadSettingsPage();
    }
}

// 保存 Turnstile Site Key & Secret Key
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
            alert('Cloudflare Turnstile 密钥保存成功！');
            loadSettingsPage();
        } else {
            const data = await res.json();
            alert('保存失败: ' + (data.error || '未知错误'));
        }
    } catch (err) {
        alert('保存失败: ' + err.message);
    }
}

// 辅助复制文本工具
function copyToClipboard(inputId) {
    const inputEl = document.getElementById(inputId);
    if (!inputEl) return;
    
    inputEl.select();
    inputEl.setSelectionRange(0, 99999); // 适配手机端

    try {
        navigator.clipboard.writeText(inputEl.value);
        alert('已成功复制到剪贴板！');
    } catch (err) {
        // 降级使用 execCommand
        try {
            document.execCommand('copy');
            alert('已成功复制到剪贴板！');
        } catch (e) {
            alert('复制失败，请手动选中并复制。');
        }
    }
}

// 财务与账单套餐中心初始化与加载
async function loadBillingPage() {
    try {
        const res = await fetchAPI('/api/user/billing');
        if (!res.ok) {
            alert('获取账单信息失败，请稍后重试');
            return;
        }

        const data = await res.json();

        // 1. 渲染当前套餐与配额信息
        const planNameMap = {
            'free': '免费版',
            'junior': '初级套餐',
            'intermediate': '中级套餐',
            'senior': '高级套餐'
        };

        const currentPlan = planNameMap[data.plan] || data.plan || '免费版';
        let expiresDesc = '无限期';
        if (data.expires_at > 0) {
            expiresDesc = new Date(data.expires_at * 1000).toLocaleString();
            if (Date.now() / 1000 > data.expires_at) {
                expiresDesc += ' (已到期)';
            }
        }

        const billingInfoEl = document.getElementById('billing-user-plan-info');
        if (billingInfoEl) {
            billingInfoEl.innerText = `${currentPlan} (${expiresDesc})`;
        }
        const quotaInfoEl = document.getElementById('billing-user-quota-info');
        if (quotaInfoEl) {
            quotaInfoEl.innerText = `域名额度: ${data.domain_count} / ${data.domain_limit}`;
        }

        // 2. 渲染可购买套餐卡片
        const container = document.getElementById('billing-plans-container');
        if (!container) return;
        container.innerHTML = '';

        if (!data.plans || data.plans.length === 0) {
            container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px 0;">系统暂无配置计费套餐。</div>';
            return;
        }

        data.plans.forEach(p => {
            // 构造购买套餐卡片 HTML
            const card = document.createElement('div');
            card.className = 'card';
            card.style = 'padding: 24px; display: flex; flex-direction: column; justify-content: space-between; border-top: 4px solid var(--primary-color); position: relative;';

            // 是否当前套餐
            if (data.plan === p.id) {
                const badge = document.createElement('div');
                badge.innerText = '当前使用中';
                badge.style = 'position: absolute; top: 12px; right: 12px; font-size: 0.75rem; background: var(--primary-color); color: #fff; padding: 2px 8px; border-radius: 4px; font-weight: 600;';
                card.appendChild(badge);
            }

            // 价格 cycle 选项 select
            let cycleSelectOptions = '';
            const cycleNames = {
                'monthly': '按月付',
                'quarterly': '按季付',
                'semiannually': '每半年付',
                'annually': '按年付'
            };
            const cycleMonths = {
                'monthly': '/月',
                'quarterly': '/季',
                'semiannually': '/半年',
                'annually': '/年'
            };

            // 过滤支持的周期价格，默认显示第一个 (按月付优先)
            let defaultCycle = '';
            const cycleKeys = ['monthly', 'quarterly', 'semiannually', 'annually'];
            for (let c of cycleKeys) {
                if (p.prices[c] !== undefined && parseFloat(p.prices[c]) >= 0) {
                    if (!defaultCycle) defaultCycle = c;
                    cycleSelectOptions += `<option value="${c}" data-price="${p.prices[c]}">${cycleNames[c]} - ￥${p.prices[c]}${cycleMonths[c]}</option>`;
                }
            }

            // 构建支付按钮，默认添加钱包余额优先扣减支付
            let payButtonsHTML = `<button class="btn btn-primary" style="margin-top: 12px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border: none; font-weight: 600;" onclick="placeOrder('${p.id}', '${p.id}-cycle-select', 'balance', '')">
                💰 钱包余额支付 (当前余额: ￥${(data.balance || 0).toFixed(2)})
            </button>`;

            if (data.payment_methods) {
                if (data.payment_methods.epay) {
                    payButtonsHTML += `<button class="btn btn-primary" style="margin-top: 8px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;" onclick="placeOrder('${p.id}', '${p.id}-cycle-select', 'epay', '')">
                        💳 易支付聚合收银台
                    </button>
                    <div style="display: flex; gap: 8px; margin-top: 6px;">
                        <button class="btn btn-outline" style="flex: 1; padding: 6px; font-size: 0.85rem;" onclick="placeOrder('${p.id}', '${p.id}-cycle-select', 'epay', 'alipay')">💙 支付宝</button>
                        <button class="btn btn-outline" style="flex: 1; padding: 6px; font-size: 0.85rem;" onclick="placeOrder('${p.id}', '${p.id}-cycle-select', 'epay', 'wxpay')">💚 微信支付</button>
                    </div>`;
                }
                if (data.payment_methods.mgate) {
                    payButtonsHTML += `<button class="btn btn-outline" style="margin-top: 8px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;" onclick="placeOrder('${p.id}', '${p.id}-cycle-select', 'mgate')">
                        🚀 快捷微信/支付宝 (MGate)
                    </button>`;
                }
                if (data.payment_methods.usdt) {
                    payButtonsHTML += `<button class="btn btn-outline" style="margin-top: 8px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; border-color: #26a17b; color: #26a17b;" onclick="placeOrder('${p.id}', '${p.id}-cycle-select', 'usdt')">
                        🟢 自动链上对账 (USDT-TRC20)
                    </button>`;
                }
            }

            if (!payButtonsHTML) {
                payButtonsHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; margin-top: 15px;">系统管理员暂未配置支付网关。</div>`;
            }

            card.innerHTML += `
                <div>
                    <h3 style="margin: 0; font-size: 1.2rem; color: var(--text-light);">${p.name}</h3>
                    <div style="font-size: 2rem; font-weight: 700; color: var(--primary-color); margin: 16px 0 8px 0;" id="${p.id}-price-display">
                        ￥${p.prices[defaultCycle] || '0'}
                    </div>
                    <ul style="padding-left: 20px; color: var(--text-muted); font-size: 0.9rem; line-height: 1.6; margin-bottom: 20px;">
                        <li>支持托管域名数：<strong>${p.domain_limit}</strong> 个</li>
                        <li>独立智能三网 DNS 解析线路</li>
                        <li>提供专业 DDNS 客户端动态更新密钥</li>
                        <li>极速解析响应 (毫秒级)</li>
                    </ul>
                </div>
                <div>
                    <div class="form-group" style="margin-bottom: 12px;">
                        <label style="font-size: 0.8rem; color: var(--text-muted);">选择订阅结算周期</label>
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
        console.error('加载财务中心失败:', err);
    }
}

// 当用户在下拉选择周期时，更新卡片价格大字显示
function updatePriceDisplay(planId, selectEl) {
    const option = selectEl.options[selectEl.selectedIndex];
    const price = option.getAttribute('data-price');
    const priceDisplay = document.getElementById(`${planId}-price-display`);
    if (priceDisplay) {
        priceDisplay.innerText = `￥${price}`;
    }
}

// 用户发起购买下单
async function placeOrder(planId, selectId, method, payType = '') {
    const selectEl = document.getElementById(selectId);
    if (!selectEl) return;
    const cycle = selectEl.value;

    const confirmBuy = confirm(`您确认要订购【${planId}】套餐吗？`);
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
            if (data.error && data.error.includes('余额不足')) {
                if (confirm(`${data.error}\n\n是否现在开启【钱包充值】？`)) {
                    openRechargeModal();
                }
            } else {
                alert('创建订单失败: ' + (data.error || '未知错误'));
            }
            return;
        }

        if (data.paid_via === 'balance' || method === 'balance') {
            alert(data.message || '购买成功！已成功使用账户钱包余额扣款开通套餐。');
            loadBillingPage();
            return;
        }

        if (method === 'usdt') {
            // 显示 USDT 转账验证表单卡片
            const usdtCard = document.getElementById('usdt-verify-card');
            if (usdtCard) {
                usdtCard.style.display = 'block';
                document.getElementById('usdt-pay-address').innerText = data.usdt_trc20_address;
                document.getElementById('usdt-pay-amount').innerText = data.price_usdt;
                document.getElementById('usdt-verify-order-id').value = data.order_id;
                document.getElementById('usdt-verify-txid').value = '';
                
                // 滚动到该位置
                usdtCard.scrollIntoView({ behavior: 'smooth' });
                alert(`订单创建成功！\n请向地址: ${data.usdt_trc20_address}\n转账精确保留2位的 ${data.price_usdt} USDT。然后在此页面下方输入 TxID 进行对账激活。`);
            }
        } else {
            // Epay or MGate，在新标签页打开支付链接
            if (data.pay_url) {
                window.open(data.pay_url, '_blank');
            } else {
                alert('订单创建成功，但未获取到支付跳转链接，请联系系统管理员。');
            }
        }

    } catch (err) {
        alert('创建订单失败: ' + err.message);
    }
}

// 提交 USDT 订单确认激活
async function verifyUsdtOrder(event) {
    event.preventDefault();
    const orderId = document.getElementById('usdt-verify-order-id').value;
    const txId = document.getElementById('usdt-verify-txid').value.trim();

    if (!orderId || !txId) {
        alert('参数不完整，请重新检查下单。');
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
            alert('恭喜！链上对账验证成功，您的套餐已成功激活升级！');
            // 隐藏 USDT 表单
            const usdtCard = document.getElementById('usdt-verify-card');
            if (usdtCard) usdtCard.style.display = 'none';
            // 重新刷新页面以更新套餐状态
            loadBillingPage();
        } else {
            alert('对账验证失败: ' + (data.error || '未知错误'));
        }
    } catch (err) {
        alert('对账验证失败: ' + err.message);
    }
}

// 加载个人中心数据
async function loadUserProfile() {
    try {
        const res = await fetchAPI('/api/user/profile');
        if (!res.ok) return;
        const data = await res.json();

        // 1. 用户组 Badge
        const roleBadge = document.getElementById('profile-role-badge');
        if (roleBadge) {
            roleBadge.innerText = data.role === 'admin' ? '管理员' : '普通用户';
            roleBadge.className = data.role === 'admin' ? 'badge badge-primary' : 'badge';
        }

        // 2. 套餐标题
        const planNames = {
            'free': '免费版',
            'junior': '初级套餐',
            'intermediate': '中级套餐',
            'senior': '高级套餐'
        };
        const planTitle = document.getElementById('profile-plan-title');
        if (planTitle) planTitle.innerText = planNames[data.plan] || data.plan || '免费版';

        // 3. 套餐到期时间
        const expiresEl = document.getElementById('profile-expires-at');
        if (expiresEl) {
            if (!data.expires_at || data.expires_at === 0) {
                expiresEl.innerText = '无限期';
            } else {
                const date = new Date(data.expires_at * 1000);
                expiresEl.innerText = date.getFullYear() + '/' + (date.getMonth() + 1) + '/' + date.getDate() + ' ' +
                    String(date.getHours()).padStart(2, '0') + ':' +
                    String(date.getMinutes()).padStart(2, '0') + ':' +
                    String(date.getSeconds()).padStart(2, '0');
            }
        }

        // 4. 续费价格
        const renewPriceEl = document.getElementById('profile-renew-price');
        if (renewPriceEl) renewPriceEl.innerText = data.renew_price || '0';

        // 5. 最大规则数 / 托管上限
        const maxRulesEl = document.getElementById('profile-max-rules');
        if (maxRulesEl) maxRulesEl.innerText = data.domain_limit || 1;

        // 6. 钱包余额
        const balanceEl = document.getElementById('profile-balance');
        if (balanceEl) balanceEl.innerText = (data.balance || 0).toFixed(2);

        // 7. Telegram 关联
        const tgStatusEl = document.getElementById('profile-tg-status');
        if (tgStatusEl) tgStatusEl.innerText = data.telegram_id ? data.telegram_id : '未绑定';

        // 8. 自动续费开关
        const autoRenewToggle = document.getElementById('profile-auto-renew-toggle');
        if (autoRenewToggle) autoRenewToggle.checked = !!data.auto_renew;

    } catch (err) {
        console.error('加载个人中心数据失败:', err);
    }
}

// 自动续费开关切换
async function handleAutoRenewChange(enabled) {
    try {
        const res = await fetchAPI('/api/user/profile/auto-renew', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ auto_renew: enabled })
        });
        if (!res.ok) {
            alert('修改自动续费状态失败');
            loadUserProfile();
        }
    } catch (err) {
        alert('修改自动续费状态失败: ' + err.message);
        loadUserProfile();
    }
}

// 个人中心重置密码
async function handleProfilePasswordSubmit(e) {
    e.preventDefault();
    const oldPass = document.getElementById('profile-old-pass').value;
    const newPass = document.getElementById('profile-new-pass').value;

    if (!oldPass || !newPass) {
        alert('请输入当前密码和新密码');
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
            alert('密码重置成功！请重新登录');
            logout();
        } else {
            alert('修改密码失败: ' + (data.error || '原密码错误'));
        }
    } catch (err) {
        alert('修改密码失败: ' + err.message);
    }
}

// 钱包充值 Modal 交互
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
        alert('最小充值金额为 10 元');
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
            alert('创建充值订单失败: ' + (data.error || '未知错误'));
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
                alert(`充值订单创建成功！\n请向地址: ${data.usdt_trc20_address}\n转账精确保留2位的 ${data.price_usdt} USDT。转账成功后输入 TxID 进行对账到账。`);
            }
        } else {
            if (data.pay_url) {
                window.open(data.pay_url, '_blank');
            } else {
                alert('充值订单创建成功，但未获取到支付跳转链接，请联系管理员。');
            }
        }
    } catch (err) {
        alert('创建充值订单失败: ' + err.message);
    }
}

// 管理员用户管理数据加载
async function loadUsersTable() {
    try {
        const res = await fetchAPI('/api/admin/users');
        if (!res.ok) {
            alert('无法获取用户列表（无管理员权限）');
            return;
        }
        const users = await res.json();
        const tbody = document.getElementById('users-table-body');
        if (!tbody) return;

        if (!users || users.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">暂无注册用户数据</td></tr>`;
            return;
        }

        const planNames = {
            'free': '免费版',
            'junior': '初级套餐',
            'intermediate': '中级套餐',
            'senior': '高级套餐'
        };

        tbody.innerHTML = users.map(u => {
            let expiresStr = '无限期';
            if (u.expires_at && u.expires_at > 0) {
                const d = new Date(u.expires_at * 1000);
                expiresStr = d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
                    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
            }

            const roleBadge = u.role === 'admin' 
                ? `<span class="badge badge-primary">管理员</span>` 
                : `<span class="badge">普通用户</span>`;

            return `
                <tr>
                    <td>${u.id}</td>
                    <td><strong>${escapeHTML(u.username)}</strong></td>
                    <td>${roleBadge}</td>
                    <td>${planNames[u.plan] || u.plan}</td>
                    <td style="font-family: monospace; font-size: 0.85rem;">${expiresStr}</td>
                    <td><strong style="color: var(--primary);">${(u.balance || 0).toFixed(2)}</strong> 元</td>
                    <td>${u.domain_count || 0} 个</td>
                    <td>
                        <div style="display: flex; gap: 6px;">
                            <button class="btn btn-outline" style="padding: 2px 8px; font-size: 0.8rem;" onclick="openAdminEditUserModal(${u.id}, '${escapeHTML(u.username)}', '${u.role}', '${u.plan}')">✏️ 编辑</button>
                            ${u.id !== 1 ? `<button class="btn btn-outline danger" style="padding: 2px 8px; font-size: 0.8rem;" onclick="deleteAdminUser(${u.id}, '${escapeHTML(u.username)}')">🗑️ 删除</button>` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

    } catch (err) {
        console.error('加载用户列表失败:', err);
    }
}

// 打开新增用户 Modal
function openAdminCreateUserModal() {
    document.getElementById('admin-user-modal-title').innerText = '手动新增用户';
    document.getElementById('admin-user-id').value = '';
    document.getElementById('admin-user-name').value = '';
    document.getElementById('admin-user-name').disabled = false;
    document.getElementById('admin-user-role').value = 'user';
    document.getElementById('admin-user-plan').value = 'free';
    document.getElementById('admin-user-balance-group').style.display = 'none';
    document.getElementById('admin-user-expire-group').style.display = 'none';
    document.getElementById('admin-user-pass').placeholder = '请输入用户密码';
    document.getElementById('admin-user-pass').required = true;

    const modal = document.getElementById('admin-user-modal');
    if (modal) modal.classList.add('show');
}

// 打开编辑用户 Modal
function openAdminEditUserModal(id, username, role, plan) {
    document.getElementById('admin-user-modal-title').innerText = `编辑用户 [${username}]`;
    document.getElementById('admin-user-id').value = id;
    document.getElementById('admin-user-name').value = username;
    document.getElementById('admin-user-name').disabled = true;
    document.getElementById('admin-user-role').value = role || 'user';
    document.getElementById('admin-user-plan').value = plan || 'free';
    document.getElementById('admin-user-add-balance').value = '0.00';
    document.getElementById('admin-user-balance-group').style.display = 'block';
    document.getElementById('admin-user-expire-group').style.display = 'block';
    document.getElementById('admin-user-expire-select').value = 'keep';
    document.getElementById('admin-user-pass').placeholder = '若不修改密码请留空';
    document.getElementById('admin-user-pass').required = false;
    document.getElementById('admin-user-pass').value = '';

    const modal = document.getElementById('admin-user-modal');
    if (modal) modal.classList.add('show');
}

function closeAdminUserModal() {
    const modal = document.getElementById('admin-user-modal');
    if (modal) modal.classList.remove('show');
}

// 保存用户创建/编辑
async function saveAdminUser(e) {
    e.preventDefault();
    const id = document.getElementById('admin-user-id').value;
    const username = document.getElementById('admin-user-name').value;
    const role = document.getElementById('admin-user-role').value;
    const plan = document.getElementById('admin-user-plan').value;
    const newPass = document.getElementById('admin-user-pass').value;

    if (!id) {
        // 创建新用户
        try {
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
                alert(`用户 [${username}] 创建成功！`);
                closeAdminUserModal();
                loadUsersTable();
            } else {
                alert('创建用户失败: ' + (data.error || '未知错误'));
            }
        } catch (err) {
            alert('创建用户失败: ' + err.message);
        }
    } else {
        // 编辑修改已有用户
        const addBalance = parseFloat(document.getElementById('admin-user-add-balance').value) || 0;
        const expireChoice = document.getElementById('admin-user-expire-select').value;
        let expiresAt = -1; // -1 表示不修改

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
                alert(`用户 [${username}] 设置已更新！`);
                closeAdminUserModal();
                loadUsersTable();
            } else {
                alert('更新用户失败: ' + (data.error || '未知错误'));
            }
        } catch (err) {
            alert('更新用户失败: ' + err.message);
        }
    }
}

// 删除用户
async function deleteAdminUser(id, username) {
    if (!confirm(`警告：确认要删除用户 [${username}] 及其拥有的所有解析记录吗？此操作不可逆！`)) return;

    try {
        const res = await fetchAPI('/api/admin/users/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: id })
        });
        const data = await res.json();
        if (res.ok) {
            alert(`用户 [${username}] 已成功删除！`);
            loadUsersTable();
        } else {
            alert('删除失败: ' + (data.error || '未知错误'));
        }
    } catch (err) {
        alert('删除失败: ' + err.message);
    }
}

// 动态加载访问者外网/本机 IP
async function loadVisitorIP() {
    const el = document.getElementById('visitor-ip-display');
    if (!el) return;
    try {
        const res = await fetch('/api/ip');
        if (res.ok) {
            const data = await res.json();
            if (data.ip) {
                el.innerText = `本机 IP: ${data.ip}`;
                return;
            }
        }
    } catch (e) {}
    
    try {
        const res = await fetch('https://api.ipify.org?format=json');
        if (res.ok) {
            const data = await res.json();
            if (data.ip) {
                el.innerText = `本机 IP: ${data.ip}`;
            }
        }
    } catch (e) {
        el.innerText = `本机 IP: 未获取`;
    }
}

// 个人中心一键使用钱包余额扣款续费
async function renewProfileWithBalance() {
    if (!confirm('确认要使用账户钱包余额划扣 30 天月费为当前套餐开通续费吗？')) return;

    try {
        const res = await fetchAPI('/api/user/profile/renew', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            alert(data.message || '续费成功！已成功从账户钱包划扣 30 天');
            loadUserProfile();
        } else {
            if (data.error && data.error.includes('余额不足')) {
                if (confirm(`${data.error}\n\n是否现在开启【钱包充值】？`)) {
                    openRechargeModal();
                }
            } else {
                alert('续费失败: ' + (data.error || '未知错误'));
            }
        }
    } catch (err) {
        alert('续费失败: ' + err.message);
    }
}
