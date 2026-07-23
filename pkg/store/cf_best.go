package store

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// StartCFBestIPCron 启动后台 Cloudflare 优选 IP 同步协程
func (s *MemoryStore) StartCFBestIPCron() {
	// 启动时立即执行一次同步
	go s.SyncCloudflareBestIPs()

	ticker := time.NewTicker(15 * time.Minute) // 每 15 分钟检查一次配置
	go func() {
		var lastSync time.Time
		for range ticker.C {
			enabled := s.GetSetting("cf_best_enabled", "false")
			if enabled != "true" {
				continue
			}
			intervalStr := s.GetSetting("cf_best_interval", "30") // 默认 30 分钟
			intervalMin, err := strconv.Atoi(intervalStr)
			if err != nil || intervalMin < 5 {
				intervalMin = 30
			}
			if time.Since(lastSync) >= time.Duration(intervalMin)*time.Minute {
				s.SyncCloudflareBestIPs()
				lastSync = time.Now()
			}
		}
	}()
}

type CFBestIPResponse struct {
	Status bool   `json:"status"`
	Code   int    `json:"code"`
	Msg    string `json:"msg"`
	Info   struct {
		CM []struct {
			IP string `json:"ip"`
		} `json:"CM"`
		CT []struct {
			IP string `json:"ip"`
		} `json:"CT"`
		CU []struct {
			IP string `json:"ip"`
		} `json:"CU"`
		CN []struct {
			IP string `json:"ip"`
		} `json:"CN"`
	} `json:"info"`
}

func (s *MemoryStore) SyncCloudflareBestIPs() {
	enabled := s.GetSetting("cf_best_enabled", "false")
	if enabled != "true" {
		return
	}

	targetDomainsStr := s.GetSetting("cf_best_domain", "")
	if targetDomainsStr == "" {
		return
	}
	targetDomainsStr = strings.ReplaceAll(targetDomainsStr, "，", ",")
	targetDomains := strings.Split(targetDomainsStr, ",")

	// 读取接口地址，支持配置多个，以英文逗号分隔
	apiURLsStr := s.GetSetting("cf_best_api_url", "https://jkapi.com/api/cf_best?server=1&type=v4")
	apiURLs := strings.Split(apiURLsStr, ",")

	var ctIP, cuIP, cmIP, defIP string
	var success bool

	client := &http.Client{Timeout: 10 * time.Second}

	for _, apiURL := range apiURLs {
		apiURL = strings.TrimSpace(apiURL)
		if apiURL == "" {
			continue
		}

		log.Printf("[CF-BEST] 正在从 API 获取最新 Cloudflare 三网优选 IP: %s...", apiURL)

		resp, err := client.Get(apiURL)
		if err != nil {
			log.Printf("[CF-BEST WARNING] 请求 API [%s] 失败: %s", apiURL, err.Error())
			continue
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			log.Printf("[CF-BEST WARNING] API [%s] 返回状态码异常: %d", apiURL, resp.StatusCode)
			continue
		}

		var data CFBestIPResponse
		contentType := resp.Header.Get("Content-Type")
		if strings.Contains(apiURL, ".html") || strings.Contains(contentType, "text/html") {
			bodyBytes, err := io.ReadAll(resp.Body)
			if err != nil {
				log.Printf("[CF-BEST WARNING] 读取 API [%s] 的 HTML 失败: %s", apiURL, err.Error())
				continue
			}
			parsedData, err := parseHTMLBestIPs(string(bodyBytes))
			if err != nil {
				log.Printf("[CF-BEST WARNING] 解析 API [%s] 的 HTML 失败: %s", apiURL, err.Error())
				continue
			}
			data = parsedData
		} else {
			if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
				log.Printf("[CF-BEST WARNING] 解析 API [%s] 的 JSON 失败: %s", apiURL, err.Error())
				continue
			}
		}

		if !data.Status || len(data.Info.CT) == 0 || len(data.Info.CU) == 0 || len(data.Info.CM) == 0 {
			log.Printf("[CF-BEST WARNING] API [%s] 返回的数据不完整: %+v", apiURL, data)
			continue
		}

		ctIP = data.Info.CT[0].IP
		cuIP = data.Info.CU[0].IP
		cmIP = data.Info.CM[0].IP
		
		// 优先使用 API 中针对其他三网的 CN (三网) 优选 IP 作为默认 (DEF) 线路
		if len(data.Info.CN) > 0 {
			defIP = data.Info.CN[0].IP
		} else {
			defIP = ctIP // 如果 API 中没有提供 CN 字段，则回退使用电信 IP
		}
		success = true
		break
	}

	if !success {
		log.Printf("[CF-BEST ERROR] 所有配置的优选 IP API 均请求失败，本次更新终止。")
		return
	}

	log.Printf("[CF-BEST] 获取成功: 电信(CT): %s, 联通(CU): %s, 移动(CM): %s", ctIP, cuIP, cmIP)

	// 循环处理每个目标域名
	for _, targetDomainRaw := range targetDomains {
		targetDomain := strings.TrimSpace(targetDomainRaw)
		if targetDomain == "" {
			continue
		}

		// 使用闭包控制锁的生命周期并独立执行各个域名的数据库事务，安全可靠
		func(targetDomain string) {
			var domain, subdomain string
			s.mu.Lock()
			defer s.mu.Unlock()

			for dom := range s.Domains {
				if targetDomain == dom {
					domain = dom
					subdomain = "@"
					break
				}
				if strings.HasSuffix(targetDomain, "."+dom) {
					domain = dom
					subdomain = targetDomain[:len(targetDomain)-len(dom)-1]
					break
				}
			}

			if domain == "" {
				log.Printf("[CF-BEST ERROR] 目标域名 [%s] 未在本系统托管", targetDomain)
				return
			}

			// 更新内存中的记录
			dom := s.Domains[domain]
			key := subdomain + "_A"
			records := dom.Records[key]

			updateISPRecord := func(isp string, ip string) {
				updated := false
				for i, rec := range records {
					if rec.ISP == isp {
						records[i].Values = []string{ip}
						records[i].TTL = 60
						updated = true
						break
					}
				}
				if !updated {
					records = append(records, DNSRecord{
						Subdomain: subdomain,
						Type:      "A",
						ISP:       isp,
						Values:    []string{ip},
						TTL:       60,
					})
				}
			}

			updateISPRecord("ct", ctIP)
			updateISPRecord("cu", cuIP)
			updateISPRecord("cm", cmIP)
			updateISPRecord("def", defIP)

			dom.Records[key] = records

			// 同步写入 SQLite 数据库
			if s.db != nil {
				tx, err := s.db.Begin()
				if err != nil {
					log.Printf("[CF-BEST ERROR] 启动事务失败: %s", err.Error())
					return
				}
				defer tx.Rollback()

				var domID int64
				err = tx.QueryRow("SELECT id FROM domains WHERE name = ?", domain).Scan(&domID)
				if err != nil {
					log.Printf("[CF-BEST ERROR] 获取主域名 ID 失败: %s", err.Error())
					return
				}

				// 清理原有的 A 记录 (仅清理优选的三网和默认线路)
				_, _ = tx.Exec("DELETE FROM dns_records WHERE domain_id = ? AND subdomain = ? AND type = 'A' AND isp IN ('ct', 'cu', 'cm', 'def')", domID, subdomain)

				// 插入新的优选 A 记录
				insertSQL := "INSERT INTO dns_records (domain_id, subdomain, type, isp, values_text, ttl) VALUES (?, ?, 'A', ?, ?, 60)"
				_, _ = tx.Exec(insertSQL, domID, subdomain, "ct", ctIP)
				_, _ = tx.Exec(insertSQL, domID, subdomain, "cu", cuIP)
				_, _ = tx.Exec(insertSQL, domID, subdomain, "cm", cmIP)
				_, _ = tx.Exec(insertSQL, domID, subdomain, "def", defIP)

				if err := tx.Commit(); err != nil {
					log.Printf("[CF-BEST ERROR] 提交事务失败: %s", err.Error())
					return
				}
			}

			log.Printf("[CF-BEST] 优选 IP 已成功更新至解析记录 [%s]", targetDomain)
		}(targetDomain)
	}
}

// parseHTMLBestIPs 从网页 HTML 中提取最优的 Cloudflare 优选 IP
func parseHTMLBestIPs(htmlStr string) (CFBestIPResponse, error) {
	var resp CFBestIPResponse
	resp.Status = true
	resp.Code = 200
	resp.Msg = "success"

	// 正则提取 <tr>...</tr> 块
	trReg := regexp.MustCompile(`(?s)<tr>(.*?)</tr>`)
	// 正则提取 <td>...</td> 块
	tdReg := regexp.MustCompile(`(?s)<td>(.*?)</td>|<td[^>]*>(.*?)</td>`)

	matches := trReg.FindAllStringSubmatch(htmlStr, -1)

	type ipRecord struct {
		isp     string
		ip      string
		loss    float64
		latency float64
		speed   float64
	}
	var allRecords []ipRecord

	for _, match := range matches {
		trContent := match[1]
		if !strings.Contains(trContent, `scope="row"`) {
			continue
		}

		tdMatches := tdReg.FindAllStringSubmatch(trContent, -1)
		var tds []string
		for _, tdMatch := range tdMatches {
			val := tdMatch[1]
			if val == "" {
				val = tdMatch[2]
			}
			val = strings.TrimSpace(val)
			tagReg := regexp.MustCompile(`<[^>]*>`)
			val = tagReg.ReplaceAllString(val, "")
			val = strings.TrimSpace(val)
			tds = append(tds, val)
		}

		if len(tds) < 5 {
			continue
		}

		isp := tds[0]
		ip := tds[1]
		lossStr := strings.TrimSuffix(tds[2], "%")
		latencyStr := strings.TrimSuffix(tds[3], "ms")
		speedStr := strings.TrimSuffix(tds[4], "mb/s")

		loss, _ := strconv.ParseFloat(lossStr, 64)
		latency, _ := strconv.ParseFloat(latencyStr, 64)
		speed, _ := strconv.ParseFloat(speedStr, 64)

		allRecords = append(allRecords, ipRecord{
			isp:     isp,
			ip:      ip,
			loss:    loss,
			latency: latency,
			speed:   speed,
		})
	}

	findBest := func(ispName string) string {
		var best ipRecord
		for _, rec := range allRecords {
			if rec.isp != ispName {
				continue
			}
			if best.ip == "" {
				best = rec
				continue
			}
			if rec.loss < best.loss {
				best = rec
			} else if rec.loss == best.loss {
				if rec.speed > best.speed {
					best = rec
				} else if rec.speed == best.speed {
					if rec.latency < best.latency {
						best = rec
					}
				}
			}
		}
		return best.ip
	}

	bestCT := findBest("电信")
	bestCU := findBest("联通")
	bestCM := findBest("移动")
	bestCN := findBest("多线")

	if bestCM == "" && bestCT == "" && bestCU == "" {
		return resp, fmt.Errorf("未在 HTML 中找到有效的运营商 IP 数据")
	}

	// 填充结构体
	if bestCM != "" {
		resp.Info.CM = append(resp.Info.CM, struct {
			IP string `json:"ip"`
		}{IP: bestCM})
	}
	if bestCT != "" {
		resp.Info.CT = append(resp.Info.CT, struct {
			IP string `json:"ip"`
		}{IP: bestCT})
	}
	if bestCU != "" {
		resp.Info.CU = append(resp.Info.CU, struct {
			IP string `json:"ip"`
		}{IP: bestCU})
	}
	if bestCN != "" {
		resp.Info.CN = append(resp.Info.CN, struct {
			IP string `json:"ip"`
		}{IP: bestCN})
	}

	return resp, nil
}
