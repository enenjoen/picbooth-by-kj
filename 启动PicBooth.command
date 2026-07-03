#!/bin/zsh
cd "$(dirname "$0")"
clear
echo "正在启动 PicBooth by KJ…"
echo "请保持此窗口开启。按 Control-C 可关闭拍照台。"
echo
AUTO_OPEN=1 node server.js
