export type FxShape = "silk"|"blade"|"slash"|"lightning"|"water"|"flame"|"ink"|"vine"|"arrow"|"wind"|"shock"|"pulse"|"gravity"|"portal"|"orbit"|"shield"|"frost"|"shard"|"ember"|"mist"|"palm"|"claw";
export type FxLook = {id:string; name:string; shape:FxShape; stroke:"ribbon"|"ring"|"crystal"; tone:string; accent:string; width:number; hint:string; character?:string; stage?:string};
const look=(id:string,name:string,shape:FxShape,stroke:FxLook["stroke"],tone:string,accent:string,width:number,hint:string):FxLook=>({id,name,shape,stroke,tone,accent,width,hint});
export const FX_GENERAL:FxLook[]=[
 look("silk","流光丝带","silk","ribbon","#3bb8ff","#ccf7ff",7,"沿人物动作画一条弧线，外缘与丝芯自动分开。"),
 look("blade","新月刀光","blade","ribbon","#53b7ff","#f2fcff",12,"用弧线勾刀口，主体偏向刀锋一侧。"),
 look("slash","双轨疾斩","slash","ribbon","#7b90ff","#edf7ff",8,"拖出两道不等宽斩痕，适合快速连斩。"),
 look("lightning","分叉雷电","lightning","ribbon","#8463ff","#edfaff",5,"沿主闪电画，折线与短分叉自动生成。"),
 look("water","水流绸带","water","ribbon","#208ec7","#9ef5ed",10,"用柔和弧线绘制水带，保留水缘高光。"),
 look("flame","火舌拖尾","flame","ribbon","#fe6334","#ffe49a",10,"顺着火势拖，火舌由粗到细向外分岔。"),
 look("ink","飞白墨痕","ink","ribbon","#202735","#7a8ca0",12,"刷出偏侧墨块、留白纤维和飞溅。白底上更易检查。"),
 look("vine","缠绕藤蔓","vine","ribbon","#477a3c","#c1ef86",6,"沿路径铺藤，枝叶交替从茎部生长。"),
 look("arrow","晶芒箭束","arrow","ribbon","#42a9ee","#c7fff9",6,"从起点拖向命中点，箭尖朝末端。"),
 look("wind","交织风刃","wind","ribbon","#72bbc3","#e5ffff",11,"沿大弧线绘制松紧交织的数股风刃。"),
 look("shock","空气冲击环","shock","ring","#67b6df","#eefcff",7,"从中心往外拖，近侧更亮，远侧变细。"),
 look("pulse","双重脉冲","pulse","ring","#7788ff","#dcfaff",7,"一笔出现内外两波，适合叠加冲击。"),
 look("gravity","重力场","gravity","ring","#8b5dd7","#f0bfff",9,"用倾斜或俯仰贴合地面，环间带下压轨迹。"),
 look("portal","空间门缘","portal","ring","#544bea","#dffaff",12,"生成旋转纹理和断续电弧，环内默认留空。"),
 look("orbit","星芒轨道","orbit","ring","#426fea","#fff1ac",5,"疏密错开的星点沿轨道分布，方便布置星能。"),
 look("shield","晶格护盾","shield","ring","#57c7d9","#e4ffff",8,"投影多边形边缘和内部撑线。"),
 look("frost","冰脉结晶","frost","crystal","#4386cf","#e3ffff",12,"沿地面或轮廓刷出分叉冰脉与晶体切面。"),
 look("shard","破碎晶屑","shard","crystal","#7194d2","#fff4d4",10,"沿冲击方向散布不规则的棱面碎片。"),
 look("ember","余烬火星","ember","crystal","#d85527","#ffd276",9,"刷出沿流向拉长的火星和微弱余辉。"),
 look("mist","冷雾涡丝","mist","crystal","#7697c1","#e3efff",17,"用宽笔迹铺低亮度的涡丝和半透明雾团。"),
];
export const FX_TX:FxLook[]=[
 {...look("tx-wave","基础波动掌","palm","ring","#3e8ddd","#d3eeff",11,"中心按掌心定位，拉向出掌一侧；手形有内流纹。"),character:"陆隐",stage:"基础 · 掌形（据波动掌候选设计板）"},
 {...look("tx-wave-double","双倍波动掌","pulse","ring","#6f7cef","#cbfcff",8,"在命中点拖出两道分离前沿；不是全屏增亮。"),character:"陆隐",stage:"双倍叠加 · 命中（总库 EP03，视觉为试用建议）"},
 {...look("tx-stars","天星掌","orbit","ring","#6279f7","#ffe399",8,"先放掌力中心，再拉出星体环绕的轨道。"),character:"陆隐",stage:"掌出星辰现 · 技能据战技总库"},
 {...look("tx-rift","裂空掌","slash","ribbon","#4459e5","#d6edff",12,"由掌心往远处划出裂面，远端收束更明显。"),character:"陆隐",stage:"远程释放 · 技能据战技总库"},
 {...look("tx-claw","天兽爪 · 玄虎","claw","ribbon","#9878f3","#e9e7ff",11,"用一条扑击曲线带出三道爪痕。"),character:"陆隐",stage:"出招迎击 · 形态为试用转译"},
 {...look("tx-ice","寒冰天赋","frost","crystal","#4a9be5","#e2ffff",13,"沿束缚或地面蔓延方向刷冰脉，保留主体轮廓。"),character:"白雪",stage:"范围蔓延 · 据寒冰天赋候选设计板"},
 {...look("tx-storm","暴风斩","wind","ribbon","#4c9d9c","#d4fff7",13,"沿斧势拉出展开的风刃弧。"),character:"周山",stage:"战斗释放 · 形态为试用转译"},
 {...look("tx-blade","刀气","blade","ribbon","#5f9abe","#e5f7ff",15,"沿刀势绘大轮廓，边沿集中，中心保持通透。"),character:"章顶天",stage:"刀气释放 · 技能据战技总库"},
 {...look("tx-arrow","漩涡气劲箭矢","arrow","ribbon","#5b77f4","#e8fbff",8,"从发射点拖到目标；箭体沿轴收束。"),character:"吴胜",stage:"发射／贯穿 · 技能据战技总库"},
 {...look("tx-gravity","重力光环","gravity","ring","#7453c8","#e9c2ff",11,"倾斜环面、压低中心，作为地面重力场。"),character:"拜列",stage:"范围压制 · 技能据战技总库"},
];
const looks = new Map([...FX_GENERAL,...FX_TX].map(p=>[p.id,p]));
export const getFxLook=(id?:string)=>id?looks.get(id):undefined;

