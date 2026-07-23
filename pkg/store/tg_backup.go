package store

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"time"
)

// StartDatabaseBackupCron 启动后台定时数据库备份至 Telegram 的协程
func (s *MemoryStore) StartDatabaseBackupCron() {
	go func() {
		for {
			// 改为每分钟轮询检查，以支持配置动态修改立即生效
			time.Sleep(1 * time.Minute)

			enabled := s.GetSetting("tg_backup_enabled", "false")
			if enabled != "true" {
				continue
			}

			token := s.GetSetting("tg_bot_token", "")
			chatId := s.GetSetting("tg_chat_id", "")
			backupTimeStr := s.GetSetting("tg_backup_time", "02:00")

			if token == "" || chatId == "" {
				continue
			}

			// 解析目标时间 (时:分)
			targetTime, err := time.Parse("15:04", backupTimeStr)
			if err != nil {
				targetTime, _ = time.Parse("15:04", "02:00")
			}

			now := time.Now()
			
			// 检查当前时间的 时 和 分 是否刚好匹配目标时间
			if now.Hour() == targetTime.Hour() && now.Minute() == targetTime.Minute() {
				// 执行备份并发送
				s.ExecuteTGBackup(token, chatId)
				// 等待 1 分钟避免在同一分钟内重复触发
				time.Sleep(1 * time.Minute)
			}
		}
	}()
}

// ExecuteTGBackup 执行数据库打包并推送到 TG
func (s *MemoryStore) ExecuteTGBackup(token, chatId string) error {
	log.Println("[TG-BACKUP] 正在开始生成数据库备份...")

	// 1. 强制将内存数据落盘，确保 data.db 是最新的
	s.mu.Lock()
	err := s.saveUnlocked()
	s.mu.Unlock()
	
	if err != nil {
		log.Printf("[TG-BACKUP] [ERROR] 数据落盘失败: %v", err)
	}

	if s.filePath == "" {
		log.Printf("[TG-BACKUP] [ERROR] 数据库路径未配置")
		return fmt.Errorf("数据库路径未配置")
	}

	dbPath := s.filePath
	if strings.HasSuffix(strings.ToLower(s.filePath), ".json") {
		dbPath = strings.TrimSuffix(s.filePath, ".json") + ".db"
	}

	// 检查数据库文件是否存在
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		log.Printf("[TG-BACKUP] [ERROR] 数据库文件不存在: %s", dbPath)
		return fmt.Errorf("数据库文件不存在")
	}

	// 读取数据库文件内容
	fileData, err := os.ReadFile(dbPath)
	if err != nil {
		log.Printf("[TG-BACKUP] [ERROR] 无法读取数据库文件: %v", err)
		return fmt.Errorf("无法读取数据库文件: %v", err)
	}

	filename := fmt.Sprintf("trinet-backup-%s.db", time.Now().Format("20060102-150405"))

	// 构造 multipart 表单发送给 Telegram
	var b bytes.Buffer
	w := multipart.NewWriter(&b)

	// 添加 chat_id
	if err := w.WriteField("chat_id", chatId); err != nil {
		log.Printf("[TG-BACKUP] [ERROR] 写入 chat_id 字段失败: %v", err)
		return fmt.Errorf("构建请求失败: %v", err)
	}

	// 添加 caption (说明)
	caption := fmt.Sprintf("📦 TriNet DNS 数据库自动备份\n\n🕒 备份时间: %s\n💾 文件大小: %.2f KB", time.Now().Format("2006-01-02 15:04:05"), float64(len(fileData))/1024.0)
	w.WriteField("caption", caption)

	// 添加 document
	fw, err := w.CreateFormFile("document", filename)
	if err != nil {
		log.Printf("[TG-BACKUP] [ERROR] 创建表单文件失败: %v", err)
		return fmt.Errorf("构建表单失败: %v", err)
	}
	if _, err = fw.Write(fileData); err != nil {
		log.Printf("[TG-BACKUP] [ERROR] 写入文件内容失败: %v", err)
		return fmt.Errorf("构建文件内容失败: %v", err)
	}
	w.Close()

	// 发送 HTTP POST 请求
	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendDocument", token)
	req, err := http.NewRequest("POST", url, &b)
	if err != nil {
		log.Printf("[TG-BACKUP] [ERROR] 创建 HTTP 请求失败: %v", err)
		return fmt.Errorf("创建请求失败: %v", err)
	}
	req.Header.Set("Content-Type", w.FormDataContentType())

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[TG-BACKUP] [ERROR] 发送至 Telegram 失败 (可能是网络问题): %v", err)
		return fmt.Errorf("网络请求失败: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		log.Printf("[TG-BACKUP] [ERROR] Telegram API 返回错误 [%d]: %s", resp.StatusCode, string(respBody))
		return fmt.Errorf("Telegram 接口返回错误: %s", string(respBody))
	}

	log.Println("[TG-BACKUP] [SUCCESS] 数据库备份已成功发送至 Telegram!")
	return nil
}
