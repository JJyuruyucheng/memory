# 组件与交互来源

用户提供的三个地址按 **组件、UI 模块与交互资源库** 使用，不作为整站版式或整站风格参考。页面整体继续采用 `editorial-greeting`、奶白底色、鼠尾草绿与淡粉作者身份的既定设计。

核查日期：2026-11-16。

## 实际提取并适配的一个组件

来源：[Button by alexmaracinaru / brown-bobcat-65](https://uiverse.io/alexmaracinaru/brown-bobcat-65)。作者页面标识为 **alexmaracinaru（Alex Maracinaru）**，组件页公开显示完整 MIT License。

实际源码通过 Uiverse 自有组织的官方 [Galaxy 归档](https://github.com/uiverse-io/galaxy) 核查，固定版本为：

- [组件 HTML/CSS，提交 adbd2adde0a299a3956ea288fb444ec01891ca41](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/Buttons/alexmaracinaru_brown-bobcat-65.html)
- [同一提交的 MIT LICENSE](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/LICENSE)
- [官方归档对源码来源及 MIT 授权的说明](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/README.md)

原组件包含 `.cta svg` 的 `translateX(-5px)`、悬停回到 `translateX(0)`，以及按压时的 `scale(0.95)`。本项目仅抽取“图标轻移与按压反馈”这一小部分，适配到 `src/components.css` 的 `.primary .icon`。位移缩小到 2px，使用短暂带回弹的过渡，并补充键盘焦点、禁用状态及减少动态效果偏好。

未采用原组件的扩张蓝色圆形背景、字体、SVG 图形或整体配色；没有导入整套库、运行时脚本或外部 CDN。完整许可证与版权保留在源码 CSS 注释和 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)，构建复制 CSS 时会一起保留。

## 本项目自行实现的回应按钮

`.reaction-button[aria-pressed="true"]` 使用一次小幅心形缩放、淡粉状态色和可见焦点，不产生漂浮爱心或循环动画。它是本项目围绕现有 SVG 图标和 `aria-pressed` 状态编写的适配样式，不声称从任何资源库复制。减少动态效果时关闭过渡及缩放，已回应状态仍通过按钮文字、颜色和 `aria-pressed` 表达。

## 另外两个资源库的核查状态

| 资源库 | 本次可验证情况 | 是否提取 |
| --- | --- | --- |
| [11xy.cn](https://www.11xy.cn/) | 页面读取超时，未取得可核查的组件源码与授权 | 未提取 |
| [雷盒](https://leibox.pantoria.cn/) | 页面读取不可用，未取得可核查的组件源码与授权 | 未提取 |

这里记录的是本次访问结果，不代表网站永久不可用。后续若能访问，需核对具体组件及授权后再选用，不能仅凭站点首页或名称声明已使用其资源。

## 集成约定

主样式后加载 `src/components.css`。按钮继续使用原生 `<button>` 与现有 `.icon` SVG，不增加第三方 DOM 依赖；`.primary` 承载发布/保存等主操作，`.reaction-button` 用于有 `aria-pressed` 的回应操作。视觉与触控体验需在最终页面的桌面、手机和减少动态效果设置下检查，源码核查不能替代浏览器实测。
