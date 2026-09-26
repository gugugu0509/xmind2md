# xmind2md — 把 XMind 导图喂给 DeepSeek AI

把 `.xmind` 文件转成 **Markdown 大纲**,AI 就能直接读懂你的导图,继续做总结、改写、生成 PPT 等。

## 用法

```powershell
node xmind2md.mjs 你的导图.xmind              # 大纲打印到屏幕
node xmind2md.mjs 你的导图.xmind 输出.md       # 同时写入 Markdown 文件
node xmind2md.mjs --self-test                 # 自测(三种格式样例)
```

> 本目录下的 `xmind2md.mjs` 是脚本本体;拷贝到任何地方都能用(纯 Node,零依赖,Node ≥ 18)。

## 已验证

- 自测：`node xmind2md.mjs --self-test` —— JSON（store/deflate 压缩）与 XMind 8 老 XML，三种样例全部通过 ✅
- 真实导图：XMind 2020+ 与 XMind 8 两种打包格式均解析正确（标题层级与备注完整）✅

## 在 DSH 里让 AI 读导图(推荐工作流)

1. 转换出 Markdown(见上),例如:
   ```powershell
   node xmind2md.mjs "你的导图.xmind" "输出.md"
   ```
2. 在 DSH 会话里说(任选):
   - 「总结一下 `思维导图.md` 的内容」
   - 「把 `思维导图.md` 整理成一份 8 页 PPT」——配合 `dsh-ppt` 插件(装法见 README 上层,或对话里让 AI 直接用)
   - 「基于 `思维导图.md` 重新组织一份大纲」

> 如果会话里的 AI 有命令工具,也可以直接把 `.xmind` 路径丢给它,让它自己跑
> `node xmind2md.mjs <路径>`;没有命令工具就走上面的两步。

## 支持范围与说明

- 优先解析 XMind 2020+ 的 `content.json`(多画布、备注、空标题节点);
- XMind 8 老文件(内部 `content.xml`)尽力解析主题树,标题/层级正确,备注等富信息忽略;
- 输出统一 **UTF-8**;终端里若看到乱码,是控制台编码问题,文件本身正常(用支持 UTF-8 的编辑器打开即可);
- 节点文字里的特殊符号(如「·」)来自导图原文,原样保留;
- 转换结果可配合思维导图插件(如 `dsh-mindmap`)重新打开成可视化导图。

## 目录

```
xmind2md/
├── xmind2md.mjs            # 转换器(核心,拷贝即用)
├── make-sample.mjs         # 生成演示用 .xmind(自测/教学)
├── README.md               # 本文档
├── 样例导图.xmind          # 演示样例(可用 XMind 打开)
└── LICENSE
```

## 关于本项目

- 本项目由 **AI（DeepSeek Harness）生成**，人类负责需求定义与验收。代码未逐字复制任何第三方项目。
- 功能上与社区同类工具（如各类 `xmind2md`）目标相同，但实现路径独立：本工具是纯 Node 单文件，自行实现 ZIP 解析（EOCD + 中央目录）后解压 `content.json` / `content.xml`，不依赖任何第三方库。
- 零依赖、无网络请求、不上传任何数据 —— 你的导图只在本机解析。

## License

MIT，见 [LICENSE](LICENSE)。
