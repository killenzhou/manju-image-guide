@echo off
chcp 65001 >nul
echo 正在运行 resolve-script-scene-marker 技能测试...
python "%~dp0test_skill.py"
pause
