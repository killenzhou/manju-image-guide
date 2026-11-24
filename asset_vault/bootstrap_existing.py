# -*- coding: utf-8 -*-
"""
One-shot idempotent bootstrap script:
Imports ~50 verified Character / Scence / Pro / VFX clean panels from real Y:\\TX\\Assets
(and .vfx/approved_anchors) into Y:\\TX\\AI\\asset_vault\\library and renders vault_contact_sheet.jpg.
"""
from __future__ import annotations

import json
import pathlib
import sys

VAULT_DIR = pathlib.Path(__file__).resolve().parent
if str(VAULT_DIR) not in sys.path:
    sys.path.insert(0, str(VAULT_DIR))

import vault  # noqa: E402

ASSETS = vault.ASSETS_ROOT
AI_ROOT = vault.AI_ROOT


def run() -> None:
    vault.ensure_vault_dirs()
    print(f"Scanning source root: {ASSETS}")
    cat = vault.scan_assets(save=True)
    print(f"Catalog ready: {cat['asset_count']} assets, {cat['file_count']} files ({cat['elapsed_ms']}ms)")

    crop_jobs = [
        # ======================== Character ========================
        dict(
            asset_id="Character/LuYin_Xin", slot_name="front",
            source=ASSETS / r"Character\LuYin_Xin\Shading\PNG\A.png",
            box_pct=[0.145, 0.015, 0.835, 0.985],
            post_ops=["trim_black_edges"],
            max_side=1800,
            view_desc="陆隐新装正面全身A-pose（蓝色丹宁拼接夹克+长裤+长靴，无校色球）",
        ),
        dict(
            asset_id="Character/LuYin_Xin", slot_name="back",
            source=ASSETS / r"Character\LuYin_Xin\Shading\PNG\D.png",
            box_pct=[0.12, 0.015, 0.88, 0.985],
            post_ops=["trim_black_edges", "mask_spheres"],
            max_side=1800,
            view_desc="陆隐新装背面全身A-pose（背部白色骷髅骨纹丹宁夹克+腰包细节，无校色球）",
        ),
        dict(
            asset_id="Character/LuYin_Xin", slot_name="face",
            source=ASSETS / r"Character\LuYin_Xin\Shading\PNG\E.png",
            box_pct=[0.15, 0.02, 0.85, 0.72],
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="陆隐正面面部与深蓝黑短碎发/冰蓝瞳孔特写",
        ),
        dict(
            asset_id="Character/GeLanNi", slot_name="face",
            source=ASSETS / r"Character\GeLanNi\Shading\PNG\GeLanNi_CH_Face.jpg",
            box_px=[2700, 0, 5388, 2724],
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="格兰妮3/4侧正面精雕脸部Shading特写",
        ),
        dict(
            asset_id="Character/GeLanNi", slot_name="front_ep3",
            source=ASSETS / r"Character\GeLanNi\Design\GeLanNi.jpg",
            box_px=[1500, 820, 4500, 7750],
            post_ops=["trim_black_edges"],
            max_side=1800,
            pin_design=True,
            view_desc="格兰妮EP003白灰紧身战服正面全身设计图（已固定Design，避免误切）",
        ),
        dict(
            asset_id="Character/GeLanNi", slot_name="front_ep5",
            source=ASSETS / r"Character\GeLanNi\Design\GeLanNi_CH.jpg",
            box_pct=[0.118, 0.130, 0.205, 0.915],
            post_ops=["trim_black_edges"],
            max_side=1800,
            pin_design=True,
            view_desc="格兰妮EP005无伤包洁净正面全身设计图",
        ),
        dict(
            asset_id="Character/ZhouShan", slot_name="front",
            source=ASSETS / r"Character\ZhouShan\Shading\PNG\ZhouShan (1).png",
            box_pct=[0.10, 0.015, 0.90, 0.985],
            post_ops=["trim_black_edges", "mask_spheres"],
            max_side=1800,
            view_desc="周山军绿重甲正面全身Shading",
        ),
        dict(
            asset_id="Character/ZhouShan", slot_name="back",
            source=ASSETS / r"Character\ZhouShan\Shading\PNG\ZhouShan (4).png",
            box_pct=[0.10, 0.015, 0.90, 0.985],
            post_ops=["trim_black_edges", "mask_spheres"],
            max_side=1800,
            view_desc="周山军绿重甲背面全身Shading",
        ),
        dict(
            asset_id="Character/ZhouShan", slot_name="face",
            source=ASSETS / r"Character\ZhouShan\Shading\PNG\ZhouShan (6).png",
            box_pct=None,
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="周山3/4面部与肩甲Shading特写",
        ),
        dict(
            asset_id="Character/ZhouShan", slot_name="axe",
            source=ASSETS / r"Character\ZhouShan\Design\ZhouShanFu.jpg",
            box_pct=[0.145, 0.085, 0.215, 0.785],
            post_ops=["trim_black_edges"],
            max_side=1600,
            pin_design=True,
            view_desc="周山重型战斧正面设计图",
        ),
        dict(
            asset_id="Character/TeLeiSi", slot_name="front",
            source=ASSETS / r"Character\TeLeiSi\Shading\PNG\TeLeiSi (1).png",
            box_pct=[0.08, 0.015, 0.90, 0.985],
            post_ops=["trim_black_edges", "mask_spheres"],
            max_side=1800,
            view_desc="特蕾斯银白战甲披巾正面全身Shading",
        ),
        dict(
            asset_id="Character/TeLeiSi", slot_name="back",
            source=ASSETS / r"Character\TeLeiSi\Shading\PNG\TeLeiSi (4).png",
            box_pct=[0.08, 0.015, 0.90, 0.985],
            post_ops=["trim_black_edges", "mask_spheres"],
            max_side=1800,
            view_desc="特蕾斯银白战甲披巾背面全身Shading",
        ),
        dict(
            asset_id="Character/TeLeiSi", slot_name="face",
            source=ASSETS / r"Character\TeLeiSi\Shading\PNG\TeLeiSi (6).png",
            box_pct=None,
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="特蕾斯3/4冷艳面部Shading特写",
        ),
        dict(
            asset_id="Character/AoDun", slot_name="front",
            source=ASSETS / r"Character\AoDun\Shading\PNG\AoDun_A.png",
            box_pct=[0.10, 0.015, 0.90, 0.985],
            post_ops=["trim_black_edges", "mask_spheres"],
            max_side=1800,
            view_desc="奥顿黑红甲正面全身Shading",
        ),
        dict(
            asset_id="Character/AoDun", slot_name="face",
            source=ASSETS / r"Character\AoDun\Shading\PNG\AoDun_F.png",
            box_pct=None,
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="奥顿3/4红发异色肤质面部Shading特写",
        ),
        dict(
            asset_id="Character/AoDun", slot_name="sword",
            source=ASSETS / r"Character\AoDun\Shading\AoDun_CH_Shade.jpg",
            box_pct=[0.028, 0.21, 0.096, 0.89],
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="奥顿持红色大剑立姿单格Shading",
        ),
        dict(
            asset_id="Character/ChangFaSangShi", slot_name="body",
            source=ASSETS / r"Character\ChangFaSangShi\Shading\PNG\ChangFaSangShi_ScreenShot_02.jpeg",
            box_pct=[0.05, 0.02, 0.92, 0.98],
            post_ops=["trim_black_edges", "mask_spheres"],
            max_side=1600,
            view_desc="长发蜘蛛型尸王3/4全身甲壳节肢Shading",
        ),
        dict(
            asset_id="Character/ChangFaSangShi", slot_name="head",
            source=ASSETS / r"Character\ChangFaSangShi\Shading\PNG\ChangFaSangShi_ScreenShot_06.jpeg",
            box_pct=None,
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="长发蜘蛛型尸王猩红复眼头部Shading特写",
        ),
        dict(
            asset_id="Character/ZhangDingTian", slot_name="front",
            source=ASSETS / r"Character\ZhangDingTian\Shading\ZhangDingTian_CH_Shade.jpg",
            box_pct=[0.195, 0.165, 0.295, 0.855],
            post_ops=["trim_black_edges", "mask_spheres"],
            max_side=1800,
            view_desc="章顶天正面全身Shading",
        ),
        dict(
            asset_id="Character/ZhangDingTian", slot_name="back",
            source=ASSETS / r"Character\ZhangDingTian\Shading\ZhangDingTian_CH_Shade.jpg",
            box_pct=[0.590, 0.165, 0.695, 0.855],
            post_ops=["trim_black_edges", "mask_spheres"],
            max_side=1800,
            view_desc="章顶天背面全身Shading",
        ),
        dict(
            asset_id="Character/ZhangDingTian", slot_name="face",
            source=ASSETS / r"Character\ZhangDingTian\Shading\ZhangDingTian_CH_Shade.jpg",
            box_pct=[0.715, 0.165, 0.855, 0.855],
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="章顶天面部Shading特写",
        ),
        dict(
            asset_id="Character/BaiXue", slot_name="face",
            source=ASSETS / r"Character\BaiXue\Shading\PNG\BaiXue_CH_Face.jpg",
            box_pct=[0.34, 0.0, 0.67, 1.0],
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="白雪正面面部Shading特写",
        ),
        dict(
            asset_id="Character/BaiXue", slot_name="front_sword",
            source=ASSETS / r"Pro\ChangJian_BaiXue\Design\ChangJian_BaiXue_Pro.jpg",
            box_pct=[0.425, 0.215, 0.542, 0.855],
            post_ops=["trim_black_edges", "mask_tl_label"],
            max_side=1800,
            pin_design=True,
            view_desc="白雪持冰剑全身正面设计图",
        ),
        dict(
            asset_id="Character/EDe", slot_name="front",
            source=ASSETS / r"Character\EDe\Design\EDe_CH.jpg",
            box_pct=[0.118, 0.130, 0.290, 0.920],
            post_ops=["trim_black_edges"],
            max_side=1800,
            view_desc="厄德（含机械触手）正面全身设计图",
        ),
        dict(
            asset_id="Character/HaiDiAn", slot_name="front",
            source=ASSETS / r"Character\HaiDiAn\Shading\PNG\HaiDiAn_ScreenShot_01.jpeg",
            box_pct=[0.08, 0.02, 0.92, 0.98],
            post_ops=["trim_black_edges", "mask_spheres"],
            max_side=1800,
            view_desc="海迪安正面全身Shading",
        ),
        dict(
            asset_id="Character/YuanZhang_KeJiYuan", slot_name="front",
            source=ASSETS / r"Character\YuanZhang_KeJiYuan\Design\YuanZhang_KeJiYuan_CH.jpg",
            box_pct=[0.036, 0.180, 0.134, 0.945],
            post_ops=["trim_black_edges"],
            max_side=1800,
            view_desc="科技院冯院长拄杖正面全身设计图",
        ),
        dict(
            asset_id="Character/Yin", slot_name="face",
            source=ASSETS / r"Character\Yin\Shading\PNG\Yin_CH_Shade.jpg",
            box_pct=[0.34, 0.0, 0.67, 1.0],
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="隐3/4面部Shading特写",
        ),
        dict(
            asset_id="Character/BianYiShouD", slot_name="body",
            source=ASSETS / r"Character\BianYiShouD\Shading\PNG\BianYiShouD.0001.jpeg",
            box_pct=None,
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="触手辐射状变异兽D 3/4全身Shading",
        ),
        dict(
            asset_id="Character/BianYiShouD", slot_name="maw",
            source=ASSETS / r"Character\BianYiShouD\Shading\PNG\BianYiShouD.0004.jpeg",
            box_pct=None,
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="变异兽D张开利齿巨口Shading特写",
        ),
        dict(
            asset_id="Character/BianYiShouD_PoDong", slot_name="body",
            source=ASSETS / r"Character\BianYiShouD_PoDong\Design\BianYiShouD_PoDong_CH.jpg",
            box_pct=[0.025, 0.215, 0.146, 0.910],
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="变异兽D穿孔破洞伤态设计图",
        ),

        # ======================== Scence ========================
        dict(
            asset_id="Scence/QianXianZhenDi", slot_name="gorge",
            source=ASSETS / r"Scence\QianXianZhenDi\Shading\QianXianZhenDi_BG_Shade.jpg",
            box_px=[3375, 1184, 5230, 1958],
            post_ops=["trim_black_edges"],
            max_side=1920,
            view_desc="前线阵地峡谷壁垒远眺全景视角（Shading单格）",
        ),
        dict(
            asset_id="Scence/LouFangFeiXuNei_PoSun", slot_name="inside",
            source=ASSETS / r"Scence\LouFangFeiXuNei_PoSun\Shading\PNG\LouFangFeiXuNei_PoSun_BG_Shade1.png",
            box_pct=None,
            post_ops=["trim_black_edges"],
            max_side=1920,
            view_desc="破损楼房废墟内部大厅环境Shading（水泥立柱与坍塌顶板）",
        ),
        dict(
            asset_id="Scence/HuoJingKuangChu", slot_name="shade_main",
            source=ASSETS / r"Scence\HuoJingKuangChu\Shading\PNG\HuoJingKuangChu_BG_Shade1.png",
            box_pct=None,
            post_ops=["trim_black_edges"],
            max_side=1920,
            view_desc="火晶矿处矿道岩壁Shading主视角",
        ),
        dict(
            asset_id="Scence/KeJiYuan_ShiYanShi", slot_name="intact",
            source=ASSETS / r"Scence\KeJiYuan_ShiYanShi\Shading\PNG\KeJiYuan_ShiYanShi_BG_Shade5.png",
            box_pct=None,
            post_ops=["trim_black_edges"],
            max_side=1920,
            view_desc="科技院地下机房/实验室完好态室内全景Shading",
        ),
        dict(
            asset_id="Scence/JingCheng_KeJiYuanNei_ZhaHui", slot_name="destroyed",
            source=ASSETS / r"Scence\JingCheng_KeJiYuanNei_ZhaHui\Shading\PNG\ScreenShot00000.png",
            box_pct=None,
            post_ops=["trim_black_edges"],
            max_side=1920,
            view_desc="京城科技院内部炸毁断壁残垣Shading视角",
        ),
        dict(
            asset_id="Scence/KeJiYuan_ShiYanShi_PoSun", slot_name="ruins_day",
            source=ASSETS / r"Scence\KeJiYuan_ShiYanShi_PoSun\Design\KeJiYuan_ShiYanShi_PoSun_BG.jpg",
            box_pct=[0.476, 0.295, 0.686, 0.892],
            post_ops=["trim_black_edges"],
            max_side=1920,
            view_desc="科技院破损废墟日景露天结构设计图单格",
        ),
        dict(
            asset_id="Scence/PingMinQuJiuFangJian_Nei", slot_name="main",
            source=ASSETS / r"Scence\PingMinQuJiuFangJian_Nei\Design\PingMinQuJiuFangJian_Nei_BG.jpg",
            box_pct=[0.002, 0.112, 0.624, 0.970],
            post_ops=["trim_black_edges"],
            max_side=1920,
            view_desc="平民区旧房间室内陈设全景设计图单格",
        ),

        # ======================== Pro ========================
        dict(
            asset_id="Pro/HuoYanJingTi", slot_name="main",
            source=ASSETS / r"Pro\HuoYanJingTi\Shading\PNG\HuoYanJingTi_pro_Shade2.png",
            box_pct=None,
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="火焰晶体矿石半透烟褐橙红内部折射Shading",
        ),
        dict(
            asset_id="Pro/HuDieDao_Yin", slot_name="blade",
            source=ASSETS / r"Pro\HuDieDao_Yin\Shading\HuDieDao_Yin.png",
            box_pct=[0.14, 0.02, 0.37, 0.98],
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="隐的蝴蝶刀单柄展开洁净Shading",
        ),
        dict(
            asset_id="Pro/ZhangDao_ZhangDingTian", slot_name="blade",
            source=ASSETS / r"Pro\ZhangDao_ZhangDingTian\Design\ZhangDao_ZhangDingTian_Pro.jpg",
            box_pct=[0.085, 0.105, 0.195, 0.94],
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="章顶天长刀正面设计图单格",
        ),
        dict(
            asset_id="Pro/BiaoShiPai_ZhouShan", slot_name="tag",
            source=ASSETS / r"Pro\BiaoShiPai_ZhouShan\Shading\PNG\BiaoShiPai_ZhouShan_Pro_Shade1.png",
            box_pct=[0.28, 0.05, 0.72, 0.98],
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="周山军用金属标识牌与链条Shading",
        ),

        # ======================== VFX ========================
        dict(
            asset_id="VFX/TianXingGong", slot_name="moon_star",
            source=ASSETS / r"其他设计\TianXingGong\Design\TianXingGong.jpg",
            box_pct=[0.025, 0.285, 0.236, 0.805],
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="天星功月球星辰环形山蓄势原画单格",
        ),
        dict(
            asset_id="VFX/JiNengTiXian_LuYin", slot_name="slash",
            source=ASSETS / r"其他设计\JiNengTiXian_LuYin\Design\JiNengTiXian_LuYin.png",
            box_pct=[0.328, 0.229, 0.440, 0.276],
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="陆隐技能青蓝丝带斩击波纹色样单格",
        ),
        dict(
            asset_id="VFX/JiNengTiXian_LuYin", slot_name="star_orb",
            source=ASSETS / r"其他设计\JiNengTiXian_LuYin\Design\JiNengTiXian_LuYin.png",
            box_pct=[0.580, 0.381, 0.635, 0.402],
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="陆隐星光球中心核单格",
        ),
        dict(
            asset_id="VFX/BaoFengZhan", slot_name="main",
            source=ASSETS / r"其他设计\BaoFengZhan\Design\BaoFengZhan.jpg",
            box_pct=[0.330, 0.158, 0.670, 0.920],
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="周山暴风斩中央主图单格",
        ),
        dict(
            asset_id="VFX/YanHuoZhang", slot_name="darkflame",
            source=ASSETS / r"其他设计\YanHuoZhang\Design\YanHuoZhang_FX.jpg",
            box_pct=[0.025, 0.310, 0.194, 0.672],
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="格兰妮炎火掌暗黑金红火焰主设计单格",
        ),
        dict(
            asset_id="VFX/JiNengTiXian_TeLeiSi", slot_name="burst",
            source=ASSETS / r"其他设计\JiNengTiXian_TeLeiSi\Design\JiNengTiXian_TeLeiSi.png",
            box_pct=[0.058, 0.160, 0.205, 0.213],
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="特蕾斯青绿暗黑外丝爆裂特效单格",
        ),
        dict(
            asset_id="VFX/JiNengTiXian_TeLeiSi", slot_name="ribbon",
            source=ASSETS / r"其他设计\JiNengTiXian_TeLeiSi\Design\JiNengTiXian_TeLeiSi.png",
            box_pct=[0.283, 0.223, 0.372, 0.2640],
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="特蕾斯青绿黑丝条带拖尾特效单格",
        ),
        dict(
            asset_id="VFX/HanBingTianFu", slot_name="frost_burst",
            source=ASSETS / r"其他设计\HanBingTianFu\Design\HanBingTianfu_FX.jpg",
            box_pct=[0.155, 0.098, 0.352, 0.515],
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="白雪寒冰天赋主冰晶爆裂设计单格",
        ),
        dict(
            asset_id="VFX/JiNengTiXian_EDe", slot_name="water_vortex",
            source=ASSETS / r"其他设计\JiNengTiXian_EDe\Design\JiNengTiXian_EDe.png",
            box_pct=[0.7525, 0.6338, 0.873, 0.6955],
            post_ops=["trim_black_edges"],
            max_side=1600,
            view_desc="厄德水涡球体UE俯视设计单格",
        ),
    ]

    reg_jobs = [
        dict(
            asset_id="VFX/LuYin_MasterV3", slot_name="pure_crop",
            clean_file=AI_ROOT / r".vfx\approved_anchors\luyin_vfx_master_v3_pure_crop.png",
            source=AI_ROOT / r".vfx\approved_anchors\luyin_vfx_master_v3_pure_crop.png",
            kind="approved_anchor",
            view_desc="陆隐最高统一总基准V3纯特效零人物切块（防近景姿态串图）",
        ),
        dict(
            asset_id="VFX/LuYin_MasterV3", slot_name="texture_tile",
            clean_file=AI_ROOT / r".vfx\approved_anchors\luyin_vfx_master_v3_texture_tile.png",
            source=AI_ROOT / r".vfx\approved_anchors\luyin_vfx_master_v3_texture_tile.png",
            kind="approved_anchor",
            view_desc="陆隐最高统一总基准V3暗黑蚀月+电蓝丝带+黑墨丝纹瓦片",
        ),
    ]

    total = 0
    for j in crop_jobs:
        meta = vault.load_asset_meta(j["asset_id"])
        existing = meta.get("slots", {}).get(j["slot_name"])
        if existing and (vault.LIBRARY_DIR / j["asset_id"] / existing["output"]["file"]).is_file():
            fresh = vault.evaluate_slot_freshness(j["asset_id"], j["slot_name"], existing, cat)
            same_box = existing.get("recipe", {}).get("box_pct") == j.get("box_pct")
            same_ops = existing.get("recipe", {}).get("post_ops") == j.get("post_ops")
            if fresh["status"] == "FRESH" and (j.get("box_pct") is None or same_box) and same_ops:
                total += 1
                print(f"  [SKIP {total:02d}] {j['asset_id']}:{j['slot_name']} -> already FRESH {existing['output']['dims']}")
                continue
        res = vault.crop_and_register(verify=True, **j)
        total += 1
        print(f"  [CROP {total:02d}] {res['asset_id']}:{res['slot']} -> {res['dims']} matte={res['detected_matte']}")

    for j in reg_jobs:
        meta = vault.load_asset_meta(j["asset_id"])
        existing = meta.get("slots", {}).get(j["slot_name"])
        if existing and (vault.LIBRARY_DIR / j["asset_id"] / existing["output"]["file"]).is_file():
            fresh = vault.evaluate_slot_freshness(j["asset_id"], j["slot_name"], existing, cat)
            same_box = existing.get("recipe", {}).get("box_pct") == j.get("box_pct")
            same_ops = existing.get("recipe", {}).get("post_ops") == j.get("post_ops")
            if fresh["status"] == "FRESH" and (j.get("box_pct") is None or same_box) and same_ops:
                total += 1
                print(f"  [SKIP {total:02d}] {j['asset_id']}:{j['slot_name']} -> already FRESH {existing['output']['dims']}")
                continue
        res = vault.register_existing_file(verify=True, **j)
        total += 1
        print(f"  [REG  {total:02d}] {res['asset_id']}:{res['slot']} -> {res['dims']} matte={res['detected_matte']}")

    cs = vault.build_contact_sheet(VAULT_DIR / "vault_contact_sheet.jpg", cols=5)
    print(f"Bootstrap complete: {total} slots verified. Contact sheet: {cs}")


if __name__ == "__main__":
    run()
