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
			enabled := s.GetSetting("tg_backup_enabled", "false")
			if enabled != "true" {
				time.Sleep(10 * time.Minute)
				continue
			}

			token := s.GetSetting("tg_bot_token", "")
			chatId := s.GetSetting("tg_chat_id", "")
			backupTimeStr := s.GetSetting("tg_backup_time", "02:00")

			if token == "" || chatId == "" {
				time.Sleep(10 * time.Minute)
				continue
			}

			// 解析目标时间 (时:分)
			targetTime, err := time.Parse("15:04", backupTimeStr)
			if err != nil {
				targetTime, _ = time.Parse("15:04", "02:00")
			}

			now := time.Now()
			next := time.Date(now.Year(), now.Month(), now.Day(), targetTime.Hour(), targetTime.Minute(), 0, 0, now.Location())

			// 如果今天的时间已经过去，则安排到明天
			if !next.After(now) {
				next = next.Add(24 * time.Hour)
			}

			durationToNext := next.Sub(now)
			log.Printf("[TG-BACKUP] 下次数据库自动备份计划于: %v (剩余等待: %v)", next.Format("2006-01-02 15:04:05"), durationToNext)

			// 休眠直到目标时间
			time.Sleep(durationToNext)

			// 执行备份并发送
			s.executeTGBackup(token, chatId)

			// 等待 1 分钟避免重复触发
			time.Sleep(1 * time.Minute)
		}
	}()
}

func (s *MemoryStore) executeTGBackup(token, chatId string) {
	log.Println("[TG-BACKUP] 正在开始生成数据库备份...")

	// 1. 强制将内存数据落盘，确保 data.db 是最新的
	s.mu.Lock()
	err := s.saveUnlocked()
	s.mu.Unlock()
	
	if err != nil {
		log.Printf("[TG-BACKUP] [ERROR] 数据落盘失败: %v", err)
		// 如果落盘失败，可能数据库文件存在问题，但我们依然可以尝试发送现有的 db
	}

	// dbPath 从环境变量获取或使用默认
	dbPath := os.Getenv("TRINET_DB_PATH")
	if dbPath == "" {
		dbPath = "data.db"
	}

	// 检查数据库文件是否存在
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		log.Printf("[TG-BACKUP] [ERROR] 数据库文件不存在: %s", dbPath)
		return
	}

	// 读取数据库文件内容
	fileData, err := os.ReadFile(dbPath)
	if err != nil {
		log.Printf("[TG-BACKUP] [ERROR] 无法读取数据库文件: %v", err)
		return
	}

	filename := fmt.Sprintf("trinet-backup-%s.db", time.Now().Format("20060102-150405"))

	// 构造 multipart 表单发送给 Telegram
	var b bytes.Buffer
	w := multipart.NewWriter(&b)

	// 添加 chat_id
	if err := w.WriteField("chat_id", chatId); err != nil {
		log.Printf("[TG-BACKUP] [ERROR] 写入 chat_id 字段失败: %v", err)
		return
	}

	// 添加 caption (说明)
	caption := fmt.Sprintf("📦 TriNet DNS 数据库自动备份\n\n🕒 备份时间: %s\n💾 文件大小: %.2f KB", time.Now().Format("2006-01-02 15:04:05"), float64(len(fileData))/1024.0)
	w.WriteField("caption", caption)

	// 添加 document
	fw, err := w.CreateFormFile("document", filename)
	if err != nil {
		log.Printf("[TG-BACKUP] [ERROR] 创建表单文件失败: %v", err)
		return
	}
	if _, err = fw.Write(fileData); err != nil {
		log.Printf("[TG-BACKUP] [ERROR] 写入文件内容失败: %v", err)
		return
	}
	w.Close()

	// 发送 HTTP POST 请求
	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendDocument", token)
	req, err := http.NewRequest("POST", url, &b)
	if err != nil {
		log.Printf("[TG-BACKUP] [ERROR] 创建 HTTP 请求失败: %v", err)
		return
	}
	req.Header.Set("Content-Type", w.FormDataContentType())

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[TG-BACKUP] [ERROR] 发送至 Telegram 失败 (可能是网络问题): %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		log.Printf("[TG-BACKUP] [ERROR] Telegram API 返回错误 [%d]: %s", resp.StatusCode, string(respBody))
		return
	}

	log.Println("[TG-BACKUP] [SUCCESS] 数据库备份已成功发送至 Telegram!")
}
