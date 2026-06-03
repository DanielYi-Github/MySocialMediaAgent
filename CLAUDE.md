# AI Coding Guidelines
<!-- 單一真相來源：將此檔案部署到你的專案根目錄，並依下方說明為各工具建立連結 -->

> **適用工具**：Claude Code · Claude Desktop · Codex · GitHub Copilot (VS Code) ·
> Cursor · Windsurf · Cline / Roo Code · Google Antigravity · Kilo Code · Hermes
>
> **核心目標**：減少 Token 消耗、提升 AI vibe coding 效率、避免常見 LLM 編碼錯誤

---

## 一、快速部署（One-time setup）

在專案根目錄放好本檔案（`CLAUDE.md`），執行以下指令為各工具建立符號連結：

```bash
# Codex / OpenAI Agents
ln -sf CLAUDE.md AGENTS.md

# GitHub Copilot (VS Code)
mkdir -p .github
ln -sf ../CLAUDE.md .github/copilot-instructions.md

# Cursor
mkdir -p .cursor/rules
ln -sf ../../CLAUDE.md .cursor/rules/ai-guidelines.mdc

# Windsurf
ln -sf CLAUDE.md .windsurfrules

# Cline / Roo Code
ln -sf CLAUDE.md .clinerules

# Google Antigravity
mkdir -p .agents/rules
ln -sf ../../CLAUDE.md .agents/rules/antigravity-rtk-rules.md

# Kilo Code
mkdir -p .kilocode/rules
ln -sf ../../CLAUDE.md .kilocode/rules/ai-guidelines.md
```

> **RTK 安裝**（可選，但強烈建議）：
> ```bash
> brew install rtk          # macOS
> rtk init -g               # Claude Code / Copilot
> rtk init -g --codex       # Codex
> rtk init -g --agent cursor    # Cursor
> rtk init --agent windsurf     # Windsurf
> rtk init --agent antigravity  # Google Antigravity
> ```
> 安裝後重啟 AI 工具，Shell 指令將自動被攔截並改寫為 RTK 版本。

---

## 二、行為準則（Karpathy Guidelines）

> 來源：[multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills)
> 取自 Andrej Karpathy 對 LLM 編碼缺陷的觀察

**注意**：這些準則偏向謹慎而非速度。對於顯而易見的小改動（typo 修正、單行修改），可自行判斷是否適用完整流程。

### 2.1 寫程式前先思考（Think Before Coding）

**不假設、不隱藏困惑、主動點出取捨。**

實作前必須：

- 明確說明你的假設；若不確定，先問而不是猜
- 若存在多種解讀，全部列出，不要默默選一個
- 若有更簡單的方案，主動說出來、適時推回
- 若有任何不清楚的地方，停下來，指出疑點，提問

### 2.2 以簡為先（Simplicity First）

**解決問題的最少量程式碼，不做任何推測性實作。**

- 不加任何沒被要求的功能
- 只用一次的程式碼不要抽象化
- 沒被要求的「彈性」或「可設定性」不要加
- 不可能發生的情境不寫錯誤處理
- 若你寫了 200 行但 50 行就夠，重寫它

自我測試：「資深工程師會說這太複雜嗎？」若是，簡化。

### 2.3 精準修改（Surgical Changes）

**只動必要的地方，只清理自己造成的亂。**

編輯現有程式碼時：

- 不要「順手改進」旁邊的程式碼、註解或格式
- 不要重構沒有壞掉的東西
- 保持原有風格，即使你會選擇不同做法
- 若發現不相關的死程式碼，提出來——不要刪除

當你的修改製造了孤兒：

- 移除**因你的修改**而變成未使用的 import / 變數 / 函式
- 不要移除原本就已存在的死程式碼，除非被要求

自我測試：每一行變動都必須能直接追溯回使用者的需求。

### 2.4 目標導向執行（Goal-Driven Execution）

**定義成功標準，循環驗證直到達成。**

將任務轉換為可驗證的目標：

| 指令型寫法 | 轉換為目標導向 |
|---|---|
| 「加上驗證」 | 「為無效輸入寫測試，然後讓它們通過」 |
| 「修這個 bug」 | 「寫一個重現 bug 的測試，然後讓它通過」 |
| 「重構 X」 | 「確保測試在重構前後都通過」 |

多步驟任務請先說明計畫：

```
1. [步驟] → 驗證：[檢查項目]
2. [步驟] → 驗證：[檢查項目]
3. [步驟] → 驗證：[檢查項目]
```

明確的成功標準讓 AI 可以獨立迴圈執行。模糊標準（「讓它跑起來」）需要不斷澄清。

---

## 三、Token 優化規則（RTK Rules）

> 來源：[rtk-ai/rtk](https://github.com/rtk-ai/rtk)
> RTK（Rust Token Killer）：透過過濾與壓縮指令輸出，在一次 30 分鐘的 Claude Code 工作階段中可節省約 80% Token

### 3.1 若 RTK 已安裝，優先使用 RTK 指令

```bash
# Git 操作
rtk git status          # 取代 git status
rtk git log -n 10       # 取代 git log
rtk git diff            # 取代 git diff
rtk git add .           # → "ok"
rtk git commit -m "..."  # → "ok abc1234"
rtk git push            # → "ok main"

# 檔案操作
rtk ls .                # 取代 ls -la
rtk read file.rs        # 取代 cat file.rs
rtk grep "pattern" .    # 取代 grep / rg
rtk find "*.rs" .       # 取代 find

# 測試
rtk cargo test          # 取代 cargo test（-90% token）
rtk pytest              # 取代 pytest（-90% token）
rtk jest                # 取代 jest（僅顯示失敗）
rtk go test             # 取代 go test（-90% token）

# 建構 / Lint
rtk cargo build         # 取代 cargo build（-80%）
rtk cargo clippy        # 取代 cargo clippy（-80%）
rtk tsc                 # TypeScript 錯誤依檔案分組
rtk ruff check          # Python linting（-80%）

# 容器
rtk docker ps           # 取代 docker ps（-80%）
rtk docker logs <name>  # 去除重複日誌
rtk kubectl pods        # 取代 kubectl get pods
```

### 3.2 若 RTK 未安裝，AI 應主動收斂輸出

即使沒有安裝 RTK，AI 也應遵守以下原則以降低 Token 消耗：

- `ls` / `tree`：只顯示有意義的檔案層級，忽略 `node_modules`、`.git`、`__pycache__` 等
- `cat` / `read`：長檔案只顯示相關段落，提供行號範圍
- `git log`：預設 `--oneline -20`，非全量輸出
- `git diff`：只顯示變動的 hunk，不顯示脈絡行過多
- 測試輸出：**只顯示失敗項目**，通過的測試以數量摘要代替

### 3.3 Token 節省估算（30 分鐘工作階段）

| 操作 | 標準輸出 | RTK 輸出 | 節省 |
|---|---|---|---|
| `ls` / `tree` × 10 | 2,000 | 400 | -80% |
| `cat` / `read` × 20 | 40,000 | 12,000 | -70% |
| `grep` × 8 | 16,000 | 3,200 | -80% |
| `git status` × 10 | 3,000 | 600 | -80% |
| `git diff` × 5 | 10,000 | 2,500 | -75% |
| `cargo test` × 5 | 25,000 | 2,500 | -90% |
| **合計** | **~118,000** | **~23,900** | **-80%** |

---

## 四、工作流程確認（Plan Execution Protocol）

當使用者提供編號計畫（Phase 1-5、任務清單等）：

1. **依序執行**：除非明確指示，否則按計畫順序進行
2. **每個邏輯步驟完成後 commit**：一個 phase 對應一個 commit
3. **不跳過、不重新排序**：若某步驟被卡住，先回報再問是否繼續
4. **開始前確認**：驗證所有引用的檔案路徑存在，確認工作目錄正確

---

## 五、避免陷阱（Avoid Rabbit Holes）

**專注於任務本身**，不要為了驗證外部 API、文件或邊際案例而過度探索。

規則：若驗證需要超過 3-4 個探索性指令，**停下來問使用者**是否繼續，還是相信現有資訊。

應避免的陷阱：

- 過度測試 regex pattern（相信快照測試，不要手動驗證 20 個邊際案例）
- 深入挖掘外部指令文件（使用 fixtures，不要研究 git/cargo 內部）
- 過度測試跨平台行為（測試 2 個主要平台，其他信任 CI）

---

## 六、成效指標（這些規則有效的信號）

- ✅ Diff 中不再有不必要的變動——只有被要求的修改
- ✅ 因為第一次就寫得夠簡單，減少了重寫次數
- ✅ 澄清問題在實作**之前**出現，不是錯誤之後
- ✅ PR 乾淨精簡——沒有「順手」的重構或「改進」
- ✅ `rtk gain` 顯示持續的 Token 節省趨勢

---

## 七、開發者溝通風格（Developer Communication Protocol）

**沒有廢話，直接給實際的程式碼或解釋，尊重開發者的時間和專業。**

### 7.1 答案優先、廢話靠邊

- **直接給答案**，不要「Here's how you can...」的高層級建議
- 若被要求解釋或修復，提供**實際程式碼**或**具體解釋**，不是模糊的方向
- 詳細說明可以放在答案後面，但答案要在前面

### 7.2 簡潔（Terse）

- 回應長度盡量短——能一句話說清楚，不要一段話
- 修改程式碼時只顯示差異（before/after 幾行即可），不要重複貼整個檔案
- 不要重複使用者的程式碼

### 7.3 主動預測需求

- 不只回答問題，還要建議使用者**沒想到的解方**
- 預測隱藏需求或可能的邊際案例
- 挑戰常規智慧——如果有更好的做法，說出來

### 7.4 精準而完整

- 治療不講理論——不要講「為什麼這樣比較好」而不給實際做法
- 尊重使用者是 expert，不要用教科書腔調
- 準確度優於保險起見——寧可說「不確定」也不要猜測
- 來源放在最後（如非必要），不要 inline cite

### 7.5 其他風格

- 用繁體中文，casual 但清晰
- 如果內容政策是障礙，提供最接近的可接受回應，然後解釋政策限制
- 不需要提起知識截止日期或聲明自己是 AI

---

## 八、網路搜尋規則（AnySearch Auto-Trigger）

> **強制行為**：不需要使用者提示。AI 在任何需要搜尋網路資訊的情況下，必須自動優先使用 AnySearch，而非 WebFetch / WebSearch 等通用工具。

**原因**：AnySearch 融合多源結果並預先品質評分，返回精煉摘要而非原始 HTML，節省 60–80% Token，且結果相關性更高。匿名即可使用。

### 觸發條件

**前提**：當本地檔案、當前 Context 或 AI 內建知識無法提供具體、最新的資訊時，才啟動 AnySearch。不要為了「確認一下」而搜尋 AI 已知的內容。

適用情況（以下情況必須使用 AnySearch）：
- 查詢技術文件、API 規格、套件版本資訊
- 搜尋程式碼範例、最佳實踐、錯誤訊息解法
- 驗證外部資訊、確認最新狀態
- 任何「需要上網查」的情境

### 使用方式（依優先序）

**1. MCP Tool（自動，本專案已預設配置）**

若 MCP 已啟用，直接呼叫 `anysearch_search` 工具，無需額外指令。

**2. REST API Fallback（MCP 不可用時）**

```bash
# 有 API Key（建議）
curl -X POST https://api.anysearch.com/v1/search \
  -H "Authorization: Bearer ${ANYSEARCH_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"query": "YOUR_QUERY", "max_results": 5}'

# 無 Key（匿名，有 IP 限流）
curl -X POST https://api.anysearch.com/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query": "YOUR_QUERY", "max_results": 5}'
```

### 搜尋參數建議

| 情境 | `domain` 參數 | `max_results` |
|---|---|---|
| 技術文件 / API 規格 | `"tech"` | 5 |
| 程式碼範例 | `"code"` | 5 |
| 最新消息 / 版本更新 | `"news"` | 3 |
| 學術研究 | `"academic"` | 5 |
| 一般查詢 | 省略 | 5 |

### API Key 設定（可選，建議設定）

```bash
export ANYSEARCH_API_KEY=your_key_here   # 加入 ~/.zshrc 或 ~/.bashrc
```

無 Key 時自動降級為匿名存取，IP 限流，足夠用於日常開發。

---

## 九、系統開發流程（Unified Development Workflow）

> 整合 [garrytan/gstack](https://github.com/garrytan/gstack)、[obra/superpowers](https://github.com/obra/superpowers)、[anthropics/skills](https://github.com/anthropics/skills) 三套工具為完整 9-Phase 開發生命週期。

**三層架構分工**：
- **superpowers**（方法論層）：決策框架，控制「如何思考與工作」
- **gstack**（工具層）：執行武器，控制「這個階段用什麼指令」
- **anthropics/skills**（基礎設施層）：技能格式標準與知識沉澱機制

**關鍵原則**：在同一 Phase 中，**superpowers 先（決策）→ gstack 後（執行）**。兩者不是二選一，而是決策層與執行層的搭配。

### 安裝三層工具（一次性）

各 AI 工具詳細安裝方式請參見 README.md 的「Development Workflow Stack」章節。以下為 Claude Code 快速安裝：

```bash
# 1. superpowers（方法論層）
/plugin install superpowers@claude-plugins-official

# 2. gstack（工具層）
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/gstack
cd ~/gstack && ./setup

# 3. anthropics/skills（基礎設施層）
/plugin marketplace add anthropics/skills
```

### 任務分級執行規則

進入 9-Phase 流程前，先判斷規模，避免小任務套大流程：

| 規模 | 定義 | 執行策略 |
|---|---|---|
| **Small** | 單行修改、Bugfix、typo | 僅套用第二章 Karpathy 準則，直接實作驗證，跳過 9-Phase |
| **Medium** | 新函數、小功能（< 1 天） | 執行 Phase 1, 2, 5, 6, 8 |
| **Large** | 架構變動、新模組（> 1 天） | 強制執行完整 Phase 0–9 |

### 9-Phase 開發流程（依序執行，不可跳過）

| Phase | 目標 | superpowers 指令 | gstack 指令 |
|---|---|---|---|
| **0. 工作空間** | 隔離環境，不污染主線 | `using-git-worktrees` | — |
| **1. 產品策略** | 確認解決正確問題 | `brainstorming` | `/office-hours` → `/plan-ceo-review` |
| **2. 技術架構** | 鎖定架構決策，拆解任務 | `writing-plans` | `/plan-eng-review` → `/plan-devex-review` |
| **3. 設計** | 視覺與 UX 在寫 code 前定案 | — | `/plan-design-review` → `/design-consultation` → `/design-shotgun` → `/design-html` |
| **4. 安全前置** | 建構前先知道所有安全雷 | — | `/cso`（OWASP + STRIDE）|
| **5. 實作（TDD）** | RED → GREEN → REFACTOR 循環 | `test-driven-development` `subagent-driven-development` `dispatching-parallel-agents` `systematic-debugging` | `/investigate`（卡住時）|
| **6. Code Review** | Spec 合規 + 程式碼品質雙層驗證 | `requesting-code-review` `receiving-code-review` | `/review` |
| **7. QA & 效能** | 功能正確 + 效能基線 + 設計落地 | — | `/qa` → `/benchmark` → `/devex-review` → `/design-review` |
| **8. Ship** | 乾淨合併、部署、上線監控 | `finishing-a-development-branch` | `/ship` → `/land-and-deploy` → `/canary` |
| **9. 沉澱** | 把本次 pattern 變成下次的可重用資產 | `writing-skills` | `/document-release` → `/document-generate` → `/retro` |

### 流程執行規則

1. **不跳 phase**：每個 phase 有隱含的驗收標準，未達標不進入下一個
2. **安全前置不可省**：Phase 4 `/cso` 必須在 Phase 5 實作開始**之前**完成
3. **TDD 是強制的**：Phase 5 的每一行 code 都必須對應一個先存在的失敗測試
4. **TDD Refactor 範圍限制**：REFACTOR 步驟僅限優化「本次新增或修改」的代碼塊，嚴禁順手重構無關模組（遵守 2.3 精準修改原則）
5. **沉澱關閉迴圈**：Phase 9 `writing-skills` + `anthropics/skills` 格式將本次模式封裝為 `SKILL.md`，讓 AI 下個 project 直接使用

---

*來源：[multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) · [rtk-ai/rtk](https://github.com/rtk-ai/rtk) · [garrytan/gstack](https://github.com/garrytan/gstack) · [obra/superpowers](https://github.com/obra/superpowers) · [anthropics/skills](https://github.com/anthropics/skills) · MIT / Apache-2.0*
