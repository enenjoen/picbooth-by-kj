#!/bin/zsh
cd "$(dirname "$0")"
clear
echo "正在以演示模式启动（无需连接相机）…"
echo "请保持此窗口开启。按 Control-C 可关闭拍照台。"
echo
AUTO_OPEN=1 BOOTH_DEMO=1 node server.js
