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
}

// 模态弹窗管理
const modalOverlay = document.getElementById('record-modal');
const modalTitle = document.getElementById('modal-title');
const recordForm = document.getElementById('record-form');

function showAddModal() {
    modalTitle.innerText = '添加域名解析';
    recordForm.reset();
    document.getElementById('input-subdomain').disabled = false;
    document.getElementById('input-domain').disabled = false;
    modalOverlay.classList.add('show');
}

function editRecord(subdomain, domain, isp, value) {
    modalTitle.innerText = '修改域名解析';
    document.getElementById('input-subdomain').value = subdomain;
    document.getElementById('input-subdomain').disabled = true; // 编辑时锁定子域名
    document.getElementById('input-domain').value = domain;
    document.getElementById('input-domain').disabled = true; // 锁定主域名
    document.getElementById('select-isp').value = isp;
    document.getElementById('input-value').value = value;
    modalOverlay.classList.add('show');
}

function closeModal() {
    modalOverlay.classList.remove('show');
}

function saveRecord(event) {
    event.preventDefault();
    // 后续对接后端 API 时在此处提交数据
    alert('保存成功 (当前为静态原型演示)');
    closeModal();
}

function generateToken() {
    const randomHex = Array.from({length: 16}, () => Math.floor(Math.random()*16).toString(16)).join('');
    alert(`已生成新 Token:\nddns_tok_${randomHex}\n请妥善保管。`);
}

function clearLogs() {
    const container = document.getElementById('log-container');
    if (container) {
        container.innerHTML = '<div class="log-row info">[' + new Date().toLocaleString() + '] [SYSTEM] 日志缓存已清空。</div>';
    }
}
