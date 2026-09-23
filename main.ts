import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";

interface RandomNoteDrawSettings {
  /** 逗号分隔的文件夹路径，这些文件夹内的笔记不会被抽到 */
  excludeFolders: string;
  /** 只抽文件名以 YYYY-MM-DD 开头的笔记（默认日记格式） */
  dailyOnly: boolean;
  /** 避免连续两次抽到同一篇 */
  avoidRepeat: boolean;
  /** 在新标签页打开，否则在当前标签页打开 */
  openInNewTab: boolean;
  /** 抽到后自动打卡记录 */
  logEnabled: boolean;
  /** 打卡记录文件路径（Markdown，自动创建） */
  logPath: string;
}

const DEFAULT_SETTINGS: RandomNoteDrawSettings = {
  excludeFolders: "",
  dailyOnly: false,
  avoidRepeat: true,
  openInNewTab: false,
  logEnabled: true,
  logPath: "Random Notes/打卡记录.md",
};

/** 默认日记命名格式：2026-09-20 等 */
const DAILY_NOTE_PATTERN = /^\d{4}-\d{2}-\d{2}/;

/** 小猫图片数量（对应 styles.css 里的 .rnd-cat-01 ~ .rnd-cat-20） */
const CAT_COUNT = 20;

function formatNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default class RandomNoteDraw extends Plugin {
  settings: RandomNoteDrawSettings;
  private lastOpened: string | null = null;

  async onload() {
    await this.loadSettings();

    this.addRibbonIcon("dice", "抽一张随机笔记", () => {
      this.drawRandomNote();
    });

    this.addCommand({
      id: "draw-random-note",
      name: "抽一张随机笔记",
      callback: () => this.drawRandomNote(),
    });

    this.addSettingTab(new RandomNoteDrawSettingTab(this.app, this));
  }

  onunload() {}

  /** 入口：从候选笔记中抽一张并打开像素风弹窗 */
  drawRandomNote() {
    const candidates = this.getCandidateNotes();
    if (candidates.length === 0) {
      new Notice("没有符合条件的笔记可抽");
      return;
    }
    new DrawModal(this.app, this).open();
  }

  /** 在候选笔记中随机选一张（考虑避免连抽同一篇） */
  pickNote(candidates: TFile[]): TFile {
    let pick = candidates[Math.floor(Math.random() * candidates.length)];

    if (this.settings.avoidRepeat && candidates.length > 1) {
      let attempts = 0;
      while (pick.path === this.lastOpened && attempts < 10) {
        pick = candidates[Math.floor(Math.random() * candidates.length)];
        attempts++;
      }
    }

    this.lastOpened = pick.path;
    return pick;
  }

  /** 打开一篇笔记 */
  openNote(file: TFile) {
    const leaf = this.settings.openInNewTab
      ? this.app.workspace.getLeaf("tab")
      : this.app.workspace.getLeaf(false);
    leaf.openFile(file);
  }

  getCandidateNotes(): TFile[] {
    let files = this.app.vault.getMarkdownFiles();

    const excludes = this.settings.excludeFolders
      .split(/[,，]/)
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter((s) => s.length > 0);

    if (excludes.length > 0) {
      files = files.filter(
        (f) =>
          !excludes.some(
            (dir) => f.path === dir || f.path.startsWith(dir + "/")
          )
      );
    }

    if (this.settings.dailyOnly) {
      files = files.filter((f) => DAILY_NOTE_PATTERN.test(f.basename));
    }

    return files;
  }

  /** 抽到后自动打卡：在记录文件末尾追加一行 */
  async logDraw(file: TFile) {
    if (!this.settings.logEnabled) return;

    const path = this.settings.logPath.trim() || DEFAULT_SETTINGS.logPath;
    const folder = path.split("/").slice(0, -1).join("/");
    const folderLabel =
      file.parent && file.parent.path !== "/" ? `（${file.parent.path}）` : "";
    const line = `- ${formatNow()} · [[${file.basename}]]${folderLabel}`;

    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.process(existing, (data) => {
        const base = data.trimEnd();
        return base ? base + "\n" + line + "\n" : line + "\n";
      });
    } else {
      if (folder) {
        await this.ensureFolder(folder);
      }
      const header = `# 随机抽卡打卡记录\n\n> 每次抽卡自动记录，时间 · 抽到的笔记。\n\n`;
      await this.app.vault.create(path, header + line + "\n");
    }
  }

  private async ensureFolder(path: string) {
    const parts = path.split("/");
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        await this.app.vault.createFolder(cur);
      }
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

/** 像素风抽卡弹窗 */
class DrawModal extends Modal {
  plugin: RandomNoteDraw;
  private card!: HTMLElement;
  private titleView!: HTMLElement;
  private folderView!: HTMLElement;
  private statusView!: HTMLElement;
  private runGuy!: HTMLElement;
  private cheerGuy!: HTMLElement;
  private lastVariant = -1;
  private current: TFile | null = null;

  constructor(app: App, plugin: RandomNoteDraw) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    this.titleEl.setText("RANDOM NOTE DRAW");
    this.modalEl.addClass("rnd-modal");

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("rnd-content");

    contentEl.createDiv({ cls: "rnd-header", text: "★ 随机抽卡 ★" });

    const wrap = contentEl.createDiv({ cls: "rnd-card-wrap" });
    this.card = wrap.createDiv({ cls: "rnd-card" });

    const back = this.card.createDiv({ cls: "rnd-face rnd-back" });
    back.createDiv({ cls: "rnd-question", text: "?" });
    this.runGuy = back.createDiv({ cls: "rnd-cat-img rnd-cat-back" });

    const front = this.card.createDiv({ cls: "rnd-face rnd-front" });
    this.cheerGuy = front.createDiv({ cls: "rnd-cat-img rnd-cat-front" });
    this.titleView = front.createDiv({ cls: "rnd-title" });
    this.folderView = front.createDiv({ cls: "rnd-folder" });

    const btns = contentEl.createDiv({ cls: "rnd-buttons" });
    btns
      .createEl("button", { cls: "rnd-btn rnd-btn-primary", text: "打开笔记" })
      .addEventListener("click", () => this.openCurrent());
    btns
      .createEl("button", { cls: "rnd-btn", text: "再抽一张" })
      .addEventListener("click", () => this.draw());
    btns
      .createEl("button", { cls: "rnd-btn", text: "关闭" })
      .addEventListener("click", () => this.close());

    this.statusView = contentEl.createDiv({ cls: "rnd-status", text: "洗牌中…" });

    this.draw();
  }

  /** 抽一张并执行翻卡动画，同时自动打卡 */
  draw() {
    const candidates = this.plugin.getCandidateNotes();
    if (candidates.length === 0) {
      new Notice("没有符合条件的笔记可抽");
      return;
    }

    this.current = this.plugin.pickNote(candidates);
    this.applyRandomCat();
    this.card.removeClass("revealed");
    this.statusView.setText("洗牌中…");

    window.setTimeout(() => {
      if (!this.current) return;
      this.titleView.setText(this.current.basename);
      const folder =
        this.current.parent && this.current.parent.path !== "/"
          ? this.current.parent.path
          : "根目录";
      this.folderView.setText(folder);
      this.card.addClass("revealed");
      this.statusView.setText("抽到啦！");
      this.plugin.logDraw(this.current);
    }, 650);
  }

  /** 每次抽卡随机换一只小猫（避免连续两次同款） */
  applyRandomCat() {
    let idx = Math.floor(Math.random() * CAT_COUNT) + 1; // 1..20
    if (CAT_COUNT > 1) {
      let attempts = 0;
      while (idx === this.lastVariant && attempts < 10) {
        idx = Math.floor(Math.random() * CAT_COUNT) + 1;
        attempts++;
      }
    }
    for (let i = 1; i <= CAT_COUNT; i++) {
      const cls = `rnd-cat-${String(i).padStart(2, "0")}`;
      this.runGuy.removeClass(cls);
      this.cheerGuy.removeClass(cls);
    }
    const chosen = `rnd-cat-${String(idx).padStart(2, "0")}`;
    this.runGuy.addClass(chosen);
    this.cheerGuy.addClass(chosen);
    this.lastVariant = idx;
  }

  openCurrent() {
    if (!this.current) return;
    this.plugin.openNote(this.current);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

class RandomNoteDrawSettingTab extends PluginSettingTab {
  plugin: RandomNoteDraw;

  constructor(app: App, plugin: RandomNoteDraw) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("排除的文件夹")
      .setDesc(
        "逗号（中英文均可）分隔的文件夹路径，这些文件夹内的笔记不会被抽到。例如：Templates, Attachments/Images"
      )
      .addText((text) =>
        text
          .setPlaceholder("Templates, Attachments")
          .setValue(this.plugin.settings.excludeFolders)
          .onChange(async (value) => {
            this.plugin.settings.excludeFolders = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("只抽每日笔记")
      .setDesc("只抽取文件名以 YYYY-MM-DD 开头的笔记（默认日记命名格式）。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.dailyOnly)
          .onChange(async (value) => {
            this.plugin.settings.dailyOnly = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("避免连续抽到同一篇")
      .setDesc("开启后不会连续两次打开同一篇笔记（笔记不足两篇时除外）。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.avoidRepeat)
          .onChange(async (value) => {
            this.plugin.settings.avoidRepeat = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("在新标签页打开")
      .setDesc("开启后抽到的笔记在新标签页打开，否则在当前的标签页打开。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.openInNewTab)
          .onChange(async (value) => {
            this.plugin.settings.openInNewTab = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("抽卡打卡记录")
      .setDesc("每次抽到笔记时，自动在记录文件中追加一条打卡。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.logEnabled)
          .onChange(async (value) => {
            this.plugin.settings.logEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("记录文件路径")
      .setDesc("打卡记录保存为 Markdown 文件，首次抽卡时自动创建（含所在文件夹）。")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.logPath)
          .setValue(this.plugin.settings.logPath)
          .onChange(async (value) => {
            this.plugin.settings.logPath = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
