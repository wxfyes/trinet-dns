package store

import (
	"os"
	"testing"
)

func TestMemoryStoreSQLite(t *testing.T) {
	// 1. 测试全新初始化 SQLite
	dbPath := "test_trinet.db"
	// 清理旧测试数据
	_ = os.Remove(dbPath)
	defer os.Remove(dbPath)

	store := NewMemoryStore(dbPath)
	if store == nil {
		t.Fatal("Failed to create memory store")
	}

	// 确认加载了默认数据
	if _, exists := store.Domains["example.com"]; !exists {
		t.Error("Expected default domain example.com to be initialized")
	}

	// 2. 测试添加记录并验证是否落盘
	store.AddRecord("example.com", "api", "A", "ct", []string{"5.5.5.5"}, 300)
	
	// 在内存中查找
	vals, ttl := store.Lookup("example.com", "api", "A", "ct")
	if len(vals) == 0 || vals[0] != "5.5.5.5" || ttl != 300 {
		t.Errorf("Expected api.example.com to resolve to 5.5.5.5 (ttl 300), got %v (ttl %d)", vals, ttl)
	}

	// 重新载入，验证是否从 DB 还原
	store2 := NewMemoryStore(dbPath)
	vals2, ttl2 := store2.Lookup("example.com", "api", "A", "ct")
	if len(vals2) == 0 || vals2[0] != "5.5.5.5" || ttl2 != 300 {
		t.Errorf("After reload: Expected api.example.com to resolve to 5.5.5.5, got %v", vals2)
	}

	// 3. 测试删除记录
	store2.DeleteRecord("example.com", "api", "A", "ct")
	vals3, _ := store2.Lookup("example.com", "api", "A", "ct")
	if len(vals3) > 0 {
		t.Error("Expected api.example.com to be deleted")
	}

	// 重新载入，验证是否真的从 DB 删除
	store3 := NewMemoryStore(dbPath)
	vals4, _ := store3.Lookup("example.com", "api", "A", "ct")
	if len(vals4) > 0 {
		t.Error("After reload: Expected api.example.com to be deleted in DB")
	}
}

func TestMemoryStoreMigration(t *testing.T) {
	jsonPath := "test_migration.json"
	dbPath := "test_migration.db"

	// 清理环境
	_ = os.Remove(jsonPath)
	_ = os.Remove(jsonPath + ".bak")
	_ = os.Remove(dbPath)
	defer func() {
		_ = os.Remove(jsonPath)
		_ = os.Remove(jsonPath + ".bak")
		_ = os.Remove(dbPath)
	}()

	// 1. 创建虚拟 JSON 备份文件
	dummyJSON := `{
  "domains": {
    "mytest.com": {
      "ttl": 3600,
      "records": {
        "hello_A": [
          {
            "subdomain": "hello",
            "type": "A",
            "isp": "def",
            "values": ["8.8.8.8"],
            "ttl": 600
          }
        ]
      }
    }
  },
  "tokens": {
    "my_test_token": "hello.mytest.com_def"
  },
  "web_user": "migrated_admin",
  "web_pass": "migrated_pass"
}`
	if err := os.WriteFile(jsonPath, []byte(dummyJSON), 0644); err != nil {
		t.Fatal(err)
	}

	// 2. 通过指定 JSON 路径来初始化 MemoryStore
	// 期望它自动将数据迁移入 SQLite 并将原 JSON 改名为 JSON.bak
	store := NewMemoryStore(jsonPath)
	if store == nil {
		t.Fatal("Failed to load store with JSON path")
	}

	// 3. 校验账号密码是否成功迁移
	u, p := store.GetCredentials()
	if u != "migrated_admin" || p != "migrated_pass" {
		t.Errorf("Expected migrated credentials migrated_admin / migrated_pass, got %s / %s", u, p)
	}

	// 4. 校验解析记录是否成功迁移
	vals, ttl := store.Lookup("mytest.com", "hello", "A", "def")
	if len(vals) == 0 || vals[0] != "8.8.8.8" || ttl != 600 {
		t.Errorf("Expected migrated record hello.mytest.com -> 8.8.8.8, got %v (ttl %d)", vals, ttl)
	}

	// 5. 校验 Token 是否成功迁移
	target, exists := store.Tokens["my_test_token"]
	if !exists || target != "hello.mytest.com_def" {
		t.Errorf("Expected migrated token, got exists=%t, target=%s", exists, target)
	}

	// 6. 校验 JSON 原文件是否已改名为 .bak
	if _, err := os.Stat(jsonPath); !os.IsNotExist(err) {
		t.Error("Expected JSON file to be renamed to .bak")
	}
	if _, err := os.Stat(jsonPath + ".bak"); err != nil {
		t.Error("Expected JSON.bak file to exist")
	}
}
