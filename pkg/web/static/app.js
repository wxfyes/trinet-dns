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

// 检查登录状态并切换界面
function checkLogin() {
    const token = localStorage.getItem('trinet_token');
    const loginOverlay = document.getElementById('login-overlay');
    const appContainer = document.getElementById('app-container');
    if (token) {
        loginOverlay.style.display = 'none';
        appContainer.style.display = 'flex';
        loadRecords();
        setupLogStream();
    } else {
        loginOverlay.style.display = 'flex';
        appContainer.style.display = 'none';
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
    
    if (showReg) {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        title.innerText = '用户注册';
        desc.innerText = '创建一个新的 TriNet 解析账户';
    } else {
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
        title.innerText = 'TriNet DNS';
        desc.innerText = '三网智能解析控制台';
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
            checkLogin();
        } else {
            const data = await res.json();
            alert(data.error || '登录失败，请检查用户名和密码');
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

    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await res.json();
        if (res.ok) {
            alert('注册成功，请使用该账号登录！');
            toggleLoginReg(false);
        } else {
            alert(data.error || '注册失败，请稍后重试');
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
        'logs': '系统运行日志'
    };
    document.getElementById('page-title').innerText = titleMap[tabId] || '控制台';

    // 切换到对应标签时刷新数据
    if (tabId === 'records') {
        loadRecords();
    } else if (tabId === 'ddns') {
        loadDDNSTable();
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
        loadAdminSettings();
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

// 渲染 DDNS 表格
function loadDDNSTable() {
    const tbody = document.querySelector('#tab-ddns tbody');
    tbody.innerHTML = '';

    const tokens = globalData.tokens || {};
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
        // target 格式: www.example.com_ct
        const parts = target.split('_');
        const fqdn = parts[0];
        const isp = parts[1] || 'def';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="font-mono">${fqdn}</td>
            <td><span class="isp-dot ${isp}"></span>${ispNameMap[isp] || isp}</td>
            <td class="font-mono">${token.substring(0, 12)}...</td>
            <td>-</td>
            <td>
                <button class="btn btn-text danger" onclick="deleteToken('${token}')">删除</button>
            </td>
        `;
        tbody.appendChild(tr);
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
            loadRecords(); // 刷新以显示新生成的 Token
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
        const res = await fetchAPI('/api/sys/stats');
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

// 获取系统注册配置（仅对管理员可见）
async function loadAdminSettings() {
    try {
        const res = await fetchAPI('/api/admin/settings');
        const adminSection = document.getElementById('admin-settings-section');
        if (res.ok) {
            const data = await res.json();
            if (adminSection) {
                adminSection.style.display = 'block';
            }
            const toggleInput = document.getElementById('toggle-registration');
            if (toggleInput) {
                toggleInput.checked = !!data.open_registration;
            }
        } else {
            if (adminSection) {
                adminSection.style.display = 'none';
            }
        }
    } catch (err) {
        console.error('获取管理员设置失败:', err);
    }
}

// 修改开放注册设置
async function toggleRegistrationSetting(enabled) {
    try {
        const res = await fetchAPI('/api/admin/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ open_registration: enabled })
        });
        if (res.ok) {
            const data = await res.json();
            alert(`已成功${enabled ? '开启' : '关闭'}开放注册功能！`);
        } else {
            const data = await res.json();
            alert('修改失败: ' + (data.error || '未知错误'));
            // 恢复开关状态
            const toggleInput = document.getElementById('toggle-registration');
            if (toggleInput) {
                toggleInput.checked = !enabled;
            }
        }
    } catch (err) {
        alert('修改失败: ' + err.message);
        const toggleInput = document.getElementById('toggle-registration');
        if (toggleInput) {
            toggleInput.checked = !enabled;
        }
    }
}
