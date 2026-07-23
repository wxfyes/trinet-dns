package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"regexp"
	"strconv"
	"strings"
)

type IPRecord struct {
	ISP      string  `json:"isp"`
	IP       string  `json:"ip"`
	Loss     float64 `json:"loss"`
	Latency  float64 `json:"latency"`
	Speed    float64 `json:"speed"`
}

func main() {
	// 读取刚才抓回来的 HTML 文件
	content, err := ioutil.ReadFile("../scratch_uouin.html")
	if err != nil {
		fmt.Printf("读取 HTML 失败: %s\n", err.Error())
		return
	}

	htmlStr := string(content)

	// 正则提取 <tr>...</tr> 块
	trReg := regexp.MustCompile(`(?s)<tr>(.*?)</tr>`)
	// 正则提取 <td>...</td> 块
	tdReg := regexp.MustCompile(`(?s)<td>(.*?)</td>|<td[^>]*>(.*?)</td>`)

	matches := trReg.FindAllStringSubmatch(htmlStr, -1)

	var allRecords []IPRecord

	for _, match := range matches {
		trContent := match[1]
		
		// 如果包含 <th scope="row"> 说明是表格内容行
		if !strings.Contains(trContent, `scope="row"`) {
			continue
		}

		// 匹配这一行所有的 td
		// 我们可以清理一下 tr 里的 td 标签
		tdMatches := tdReg.FindAllStringSubmatch(trContent, -1)
		var tds []string
		for _, tdMatch := range tdMatches {
			val := tdMatch[1]
			if val == "" {
				val = tdMatch[2]
			}
			// 去除多余的空格、换行
			val = strings.TrimSpace(val)
			// 去除 HTML 标签（比如 a 标签等）
			tagReg := regexp.MustCompile(`<[^>]*>`)
			val = tagReg.ReplaceAllString(val, "")
			val = strings.TrimSpace(val)
			tds = append(tds, val)
		}

		if len(tds) < 5 {
			continue
		}

		isp := tds[0] // 电信 / 联通 / 移动 / IPV6 / 多线
		ip := tds[1]
		lossStr := strings.TrimSuffix(tds[2], "%")
		latencyStr := strings.TrimSuffix(tds[3], "ms")
		speedStr := strings.TrimSuffix(tds[4], "mb/s")

		loss, _ := strconv.ParseFloat(lossStr, 64)
		latency, _ := strconv.ParseFloat(latencyStr, 64)
		speed, _ := strconv.ParseFloat(speedStr, 64)

		allRecords = append(allRecords, IPRecord{
			ISP:     isp,
			IP:      ip,
			Loss:    loss,
			Latency: latency,
			Speed:   speed,
		})
	}

	// 找出各运营商（CT 电信，CU 联通，CM 移动，CN 默认多线）最优的 IP
	// 策略：丢包率为 0.00%，在此基础上延迟最低、速度最快
	var bestCT, bestCU, bestCM, bestCN IPRecord

	findBest := func(ispName string) IPRecord {
		var best IPRecord
		for _, rec := range allRecords {
			if rec.ISP != ispName {
				continue
			}
			// 必须 0 丢包（或者丢包越小越好）
			if best.IP == "" {
				best = rec
				continue
			}
			// 优选规则：丢包率越小越优先。丢包率相同，速度越快越优先。速度接近，延迟越低越优先。
			if rec.Loss < best.Loss {
				best = rec
			} else if rec.Loss == best.Loss {
				if rec.Speed > best.Speed {
					best = rec
				} else if rec.Speed == best.Speed {
					if rec.Latency < best.Latency {
						best = rec
					}
				}
			}
		}
		return best
	}

	bestCT = findBest("电信")
	bestCU = findBest("联通")
	bestCM = findBest("移动")
	bestCN = findBest("多线")

	type CFBestIPResponse struct {
		Status bool   `json:"status"`
		Code   int    `json:"code"`
		Msg    string `json:"msg"`
		Info   struct {
			CM []map[string]string `json:"CM"`
			CT []map[string]string `json:"CT"`
			CU []map[string]string `json:"CU"`
			CN []map[string]string `json:"CN"`
		} `json:"info"`
	}

	var resp CFBestIPResponse
	resp.Status = true
	resp.Code = 200
	resp.Msg = "success"

	if bestCM.IP != "" {
		resp.Info.CM = []map[string]string{{"ip": bestCM.IP}}
	}
	if bestCT.IP != "" {
		resp.Info.CT = []map[string]string{{"ip": bestCT.IP}}
	}
	if bestCU.IP != "" {
		resp.Info.CU = []map[string]string{{"ip": bestCU.IP}}
	}
	if bestCN.IP != "" {
		resp.Info.CN = []map[string]string{{"ip": bestCN.IP}}
	}

	jsonBytes, _ := json.MarshalIndent(resp, "", "  ")
	fmt.Println(string(jsonBytes))
}
