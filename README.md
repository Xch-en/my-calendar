# 我的日程 · 本地离线 PWA

手机竖屏风格的本地日程应用：FullCalendar 周视图/月视图 + Dexie.js（IndexedDB）本地存储，
支持添加到主屏幕、完全离线使用，数据不出设备。

## 运行

需要通过 HTTP 访问（Service Worker 要求），任选其一：

```bash
python -m http.server 5173
# 打开 http://127.0.0.1:5173
```

## 功能

- 默认周视图（30 分钟时间格子、当前时间指示线），可切换月视图
- 点击空白格 / 拖选时段新建事项（关闭表单后的一小段时间内再点空白不会误触发新建）；点击事项块查看、编辑、删除（二次确认）
- 待办抽屉展开时，点一下日历区域只是收回抽屉、回到时间轴，不会误触新建
- 拖拽、拉伸事项块直接调整时间（整体拖动改位置，上、下边缘拖动改时长）
- 时间重叠的事项竖排并列显示，互不遮挡
- 底部待办抽屉：点按抽屉条或上拉展开（约占 65% 屏高），竖排清单；把待办行拖到日历上即生成默认 1 小时的事项（触屏长按行后拖动，拖入日历区域抽屉即自动收回），也可点按行转表单新建
- 字段：标题、地点、开始时间、结束时间，存 IndexedDB（库名 `my-calendar`）
- PWA：manifest + Service Worker 预缓存应用外壳，离线可打开

## 添加到主屏幕

- **Android / Chrome、Edge**：菜单 →「安装应用」/「添加到主屏幕」
- **iOS Safari**：分享 →「添加到主屏幕」

## 目录结构

```
index.html            页面骨架（含 PWA meta）
manifest.json         PWA 清单
sw.js                 Service Worker（预缓存外壳）
css/style.css         样式
js/app.js             日历 + 数据库 + 表单逻辑
lib/                  FullCalendar、Dexie（已本地化，离线可用）
icons/                应用图标
tools/make_icons.py   图标生成脚本（python tools/make_icons.py，需 Pillow）
```

## 开发注意

修改任何静态文件（html/css/js/图标）后，把 `sw.js` 里的
`CACHE_VERSION` 版本号 +1，用户下次打开时才会拿到新版本。
