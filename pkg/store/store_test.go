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

func TestMemoryStoreMultiUser(t *testing.T) {
	dbPath := "test_multiuser.db"
	_ = os.Remove(dbPath)
	defer os.Remove(dbPath)

	store := NewMemoryStore(dbPath)
	if store == nil {
		t.Fatal("Failed to create memory store")
	}

	// 1. 测试注册用户
	err := store.RegisterUser("user1", "pass123", "user")
	if err != nil {
		t.Fatalf("Failed to register user1: %s", err)
	}

	// 再次注册同名用户应该报错
	err = store.RegisterUser("user1", "pass123", "user")
	if err == nil {
		t.Fatal("Expected error when registering duplicate username, got nil")
	}

	// 2. 测试登录与会话创建
	token, role, err := store.CreateSession("user1", "pass123")
	if err != nil {
		t.Fatalf("Failed to create session: %s", err)
	}
	if role != "user" {
		t.Errorf("Expected role 'user', got '%s'", role)
	}
	if token == "" {
		t.Fatal("Expected non-empty token")
	}

	// 3. 测试 Token 认证
	user, err := store.AuthenticateToken(token)
	if err != nil {
		t.Fatalf("Failed to authenticate token: %s", err)
	}
	if user.Username != "user1" || user.Role != "user" {
		t.Errorf("Authenticated user mismatch: %+v", user)
	}

	// 4. 测试修改密码
	err = store.UpdateUserPassword(user.ID, "wrong_pass", "new_pass")
	if err == nil {
		t.Fatal("Expected error when changing password with wrong current password")
	}
	err = store.UpdateUserPassword(user.ID, "pass123", "new_pass")
	if err != nil {
		t.Fatalf("Failed to change password: %s", err)
	}
	// 验证旧密码不可登录，新密码可登录
	_, _, err = store.CreateSession("user1", "pass123")
	if err == nil {
		t.Fatal("Expected login failure with old password after change")
	}
	token2, _, err := store.CreateSession("user1", "new_pass")
	if err != nil {
		t.Fatalf("Failed to login with new password: %s", err)
	}
	if token2 == "" {
		t.Fatal("Expected non-empty token2")
	}

	// 5. 测试多用户数据隔离与带权限的解析管理
	// 注册另一个普通用户 user2
	err = store.RegisterUser("user2", "pass456", "user")
	if err != nil {
		t.Fatal(err)
	}
	token3, _, _ := store.CreateSession("user2", "pass456")
	u2, _ := store.AuthenticateToken(token3)

	// user1 添加域名和记录
	err = store.AddRecordWithAuth(user.ID, user.Role, "user1domain.com", "www", "A", "def", []string{"1.1.1.1"}, 600)
	if err != nil {
		t.Fatalf("user1 failed to add record: %s", err)
	}

	// user2 试图往 user1domain.com 添加或删除记录，应当被拒
	err = store.AddRecordWithAuth(u2.ID, u2.Role, "user1domain.com", "api", "A", "def", []string{"2.2.2.2"}, 600)
	if err == nil {
		t.Fatal("Expected error when user2 writes to user1's domain")
	}
	err = store.DeleteRecordWithAuth(u2.ID, u2.Role, "user1domain.com", "www", "A", "def")
	if err == nil {
		t.Fatal("Expected error when user2 deletes from user1's domain")
	}

	// 6. 测试数据过滤隔离
	// 获取 user1 的可见数据
	data1 := store.GetUserData(user.ID, user.Role)
	if _, exists := data1.Domains["user1domain.com"]; !exists {
		t.Error("user1 should see their own domain")
	}

	// 获取 user2 的可见数据
	data2 := store.GetUserData(u2.ID, u2.Role)
	if _, exists := data2.Domains["user1domain.com"]; exists {
		t.Error("user2 should NOT see user1's domain")
	}

	// 7. 测试 DDNS Token 生成、隔离与删除
	ddnsTok, err := store.GenerateDDNSToken(user.ID, user.Role, "www.user1domain.com", "ct")
	if err != nil {
		t.Fatalf("Failed to generate DDNS token for user1: %s", err)
	}
	
	// user2 应当看不到该 Token
	data2_toks := store.GetUserData(u2.ID, u2.Role).Tokens
	if _, exists := data2_toks[ddnsTok]; exists {
		t.Error("user2 should NOT see user1's DDNS Token")
	}

	// user1 应当能看到该 Token
	data1_toks := store.GetUserData(user.ID, user.Role).Tokens
	if _, exists := data1_toks[ddnsTok]; !exists {
		t.Error("user1 should see their own DDNS Token")
	}

	// user2 试图删除 user1 的 Token 应当报错
	err = store.DeleteDDNSToken(u2.ID, u2.Role, ddnsTok)
	if err == nil {
		t.Fatal("Expected error when user2 deletes user1's DDNS Token")
	}

	// user1 删除 Token
	err = store.DeleteDDNSToken(user.ID, user.Role, ddnsTok)
	if err != nil {
		t.Fatalf("Failed to delete token: %s", err)
	}
}
