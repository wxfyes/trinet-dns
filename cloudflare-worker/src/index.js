// TriNet DNS - Cloudflare Worker 控制中心代码
// 提供了完全等效于 Go 后端的 RESTful API 与静态页面服务

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 跨域处理 (CORS)
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const getExpectedToken = async () => {
      const user = env.WEB_USER || "admin";
      const pass = env.WEB_PASS || "admin123";
      const msgBuffer = new TextEncoder().encode(user + ":" + pass);
      const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    };

    const checkAdminAuth = async (req) => {
      let token = req.headers.get("Authorization");
      if (token && token.startsWith("Bearer ")) {
        token = token.substring(7);
      } else {
        const u = new URL(req.url);
        token = u.searchParams.get("token");
      }
      const expected = await getExpectedToken();
      return token === expected;
    };

    // 1. 获取本地 KV 缓存数据，不存在则自动初始化默认数据
    const getStore = async () => {
      const data = await env.TRINET_DNS_KV.get("trinet_store");
      if (!data) {
        const defaultData = {
          domains: {
            "example.com": {
              ttl: 60,
              records: {
                "www_A": [
                  { subdomain: "www", type: "A", isp: "ct", values: ["1.1.1.1"], ttl: 60 },
                  { subdomain: "www", type: "A", isp: "cu", values: ["2.2.2.2"], ttl: 60 },
                  { subdomain: "www", type: "A", isp: "cm", values: ["3.3.3.3"], ttl: 60 },
                  { subdomain: "www", type: "A", isp: "def", values: ["4.4.4.4"], ttl: 60 }
                ]
              }
            }
          },
          tokens: {
            "ddns_tok_demo123456": "www.example.com_ct"
          }
        };
        await env.TRINET_DNS_KV.put("trinet_store", JSON.stringify(defaultData));
        return defaultData;
      }
      return JSON.parse(data);
    };

    const saveStore = async (store) => {
      await env.TRINET_DNS_KV.put("trinet_store", JSON.stringify(store));
    };

    // 2. 路由处理
    try {
      // API: 登录接口
      if (path === "/api/login" && request.method === "POST") {
        const body = await request.json();
        const user = env.WEB_USER || "admin";
        const pass = env.WEB_PASS || "admin123";
        if (body.username === user && body.password === pass) {
          const expectedToken = await getExpectedToken();
          return new Response(JSON.stringify({ status: "success", token: expectedToken }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        return new Response(JSON.stringify({ error: "用户名或密码错误" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      // API: 获取所有解析记录
      if (path === "/api/records" && request.method === "GET") {
        if (!(await checkAdminAuth(request))) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        const store = await getStore();
        return new Response(JSON.stringify(store), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      // API: 添加或修改解析记录
      if (path === "/api/records" && request.method === "POST") {
        if (!(await checkAdminAuth(request))) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        const store = await getStore();
        const body = await request.json();
        const { domain, subdomain, type, isp, values, ttl } = body;

        if (!domain || !subdomain || !type || !isp || !values) {
          return new Response(JSON.stringify({ error: "Missing required fields" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        if (!store.domains[domain]) {
          store.domains[domain] = { ttl: 60, records: {} };
        }

        const recordKey = `${subdomain}_${type}`;
        if (!store.domains[domain].records[recordKey]) {
          store.domains[domain].records[recordKey] = [];
        }

        // 检查是否已存在同 ISP 记录，存在则更新，不存在则添加
        const records = store.domains[domain].records[recordKey];
        const idx = records.findIndex(r => r.isp === isp);
        if (idx > -1) {
          records[idx].values = values;
          records[idx].ttl = ttl || 60;
        } else {
          records.push({ subdomain, type, isp, values, ttl: ttl || 60 });
        }

        await saveStore(store);
        return new Response(JSON.stringify({ message: "Record saved successfully" }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      // API: 删除解析记录
      if (path === "/api/records" && request.method === "DELETE") {
        if (!(await checkAdminAuth(request))) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        const store = await getStore();
        const body = await request.json();
        const { domain, subdomain, type, isp } = body;

        if (!domain || !subdomain || !type || !isp) {
          return new Response(JSON.stringify({ error: "Missing required fields" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        if (store.domains[domain] && store.domains[domain].records) {
          const recordKey = `${subdomain}_${type}`;
          const records = store.domains[domain].records[recordKey];
          if (records) {
            store.domains[domain].records[recordKey] = records.filter(r => r.isp !== isp);
            if (store.domains[domain].records[recordKey].length === 0) {
              delete store.domains[domain].records[recordKey];
            }
          }
        }

        await saveStore(store);
        return new Response(JSON.stringify({ message: "Record deleted successfully" }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      // API: DDNS 动态上报接口
      if (path === "/api/ddns/update" && request.method === "POST") {
        const store = await getStore();
        
        // 鉴权 (支持 Header 或 Query String)
        let token = request.headers.get("Authorization");
        if (token && token.startsWith("Bearer ")) {
          token = token.substring(7);
        } else {
          token = url.searchParams.get("token");
        }

        if (!token || !store.tokens[token]) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        // 获取上报 IP (优先读取参数，否则自动获取连接 IP)
        let ip = "";
        try {
          const formData = await request.formData();
          ip = formData.get("ip");
        } catch {
          try {
            const body = await request.json();
            ip = body.ip;
          } catch {}
        }

        if (!ip) {
          ip = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
        }

        // 解析 Token 绑定的域名与线路 (格式: sub.domain.com_isp)
        const binding = store.tokens[token];
        const lastUnderscore = binding.lastIndexOf("_");
        if (lastUnderscore === -1) {
          return new Response(JSON.stringify({ error: "Invalid token binding format" }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        const fullDomain = binding.substring(0, lastUnderscore);
        const isp = binding.substring(lastUnderscore + 1);

        // 拆分出主域名和子域名
        const parts = fullDomain.split(".");
        if (parts.length < 2) {
          return new Response(JSON.stringify({ error: "Invalid domain format in token binding" }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        const domain = parts.slice(-2).join(".");
        const subdomain = parts.slice(0, -2).join(".");

        if (!store.domains[domain]) {
          store.domains[domain] = { ttl: 60, records: {} };
        }

        const recordKey = `${subdomain}_A`;
        if (!store.domains[domain].records[recordKey]) {
          store.domains[domain].records[recordKey] = [];
        }

        const records = store.domains[domain].records[recordKey];
        const idx = records.findIndex(r => r.isp === isp);
        if (idx > -1) {
          records[idx].values = [ip];
        } else {
          records.push({ subdomain, type: "A", isp, values: [ip], ttl: 60 });
        }

        await saveStore(store);
        return new Response(`nochg ${ip}`, {
          headers: { "Content-Type": "text/plain", ...corsHeaders }
        });
      }

      // API: DDNS Token 管理列表
      if (path === "/api/ddns/tokens" && request.method === "GET") {
        if (!(await checkAdminAuth(request))) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        const store = await getStore();
        return new Response(JSON.stringify(store.tokens || {}), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      // API: 创建 DDNS Token
      if (path === "/api/ddns/tokens" && request.method === "POST") {
        if (!(await checkAdminAuth(request))) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        const store = await getStore();
        const body = await request.json();
        const { token, binding } = body;

        if (!token || !binding) {
          return new Response(JSON.stringify({ error: "Missing token or binding" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        if (!store.tokens) {
          store.tokens = {};
        }

        store.tokens[token] = binding;
        await saveStore(store);
        return new Response(JSON.stringify({ message: "Token created successfully" }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      // API: 删除 DDNS Token
      if (path === "/api/ddns/tokens" && request.method === "DELETE") {
        if (!(await checkAdminAuth(request))) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        const store = await getStore();
        const body = await request.json();
        const { token } = body;

        if (!token) {
          return new Response(JSON.stringify({ error: "Missing token" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        if (store.tokens && store.tokens[token]) {
          delete store.tokens[token];
        }

        await saveStore(store);
        return new Response(JSON.stringify({ message: "Token deleted successfully" }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      // 静态资源路由响应
      if (path === "/" || path === "/index.html") {
        return new Response(HTML_CONTENT, {
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      }

      if (path === "/style.css") {
        return new Response(CSS_CONTENT, {
          headers: { "Content-Type": "text/css; charset=utf-8" }
        });
      }

      if (path === "/app.js") {
        return new Response(JS_CONTENT, {
          headers: { "Content-Type": "application/javascript; charset=utf-8" }
        });
      }

      return new Response("Not Found", { status: 404 });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
  }
};

// ==========================================
// 静态前端 HTML, CSS, JS 嵌入变量声明 (通过 build-worker.js 自动生成注入)
// ==========================================
const HTML_CONTENT = `__HTML_PLACEHOLDER__`;
const CSS_CONTENT = `__CSS_PLACEHOLDER__`;
const JS_CONTENT = `__JS_PLACEHOLDER__`;
