// Topic groups from the user-supplied optimized onboarding (2026-10-26, prototype v8).
// These are UI subscription groups; they do not imply an identity or audience.
export const OPTIMIZED_TOPIC_GROUPS = [
        { id: "study", label: "学业与教务", icon: "▤", subgroups: [
          { label: "本科教学", tags: ["选课", "GPA", "期末考试", "教材", "学籍注册", "辅修", "重修"] },
          { label: "研究生培养", tags: ["考博", "硕博连读", "研究生教务", "科研奖励", "中期考核", "开题", "资格考", "学位论文", "导师选择"] },
          { label: "实践教学", tags: ["课外研学", "实习实践", "SRTP", "大创", "创新创业"] }
        ]},
        { id: "further", label: "升学与深造", icon: "↗", subgroups: [
          { label: "升学路径", tags: ["保研", "考研", "留学", "双学位"] },
          { label: "交流培养", tags: ["联合培养", "中外合作办学", "交换", "暑期学校", "访学", "国家留学基金"] }
        ]},
        { id: "career", label: "求职与就业", icon: "▣", subgroups: [
          { label: "校园招聘", tags: ["秋招春招", "宣讲会", "双选会", "网申", "实习", "事业单位", "选调", "企业参访"] },
          { label: "就业服务", tags: ["就业手续", "职业规划", "创业"] },
          { label: "行业方向", tags: ["互联网", "国企央企", "汽车", "芯片半导体", "金融", "建筑地产"] }
        ]},
        { id: "research", label: "科研与创新", icon: "✧", subgroups: [
          { label: "科研训练", tags: ["实验室", "项目申报", "成果转化", "科研助理", "创新创业"] },
          { label: "学科竞赛", tags: ["学科竞赛", "机器人", "互联网+"] },
          { label: "学术研究", tags: ["科研成果", "论文", "学术会议", "学术报告", "国自然", "社科基金", "AI/机器学习"] }
        ]},
        { id: "community", label: "社团与组织", icon: "♫", subgroups: [
          { label: "学生组织", tags: ["学生会", "研究生会", "班团建设", "校科协"] },
          { label: "社团活动", tags: ["社团活动", "社团招新", "百团大战", "社团文化节"] },
          { label: "艺术与体育", tags: ["演出", "迎新晚会", "体育赛事", "运动会", "阳光体育", "电子竞技"] },
          { label: "志愿与公益", tags: ["志愿服务", "社会实践", "公益", "支教", "献血"] }
        ]},
        { id: "campus", label: "校园生活", icon: "☀", subgroups: [
          { label: "安全与服务", tags: ["防诈骗", "总务后勤"] },
          { label: "讲座与文化", tags: ["讲座", "六朝松大师讲堂", "吴健雄大讲堂", "文化素质教育", "展览"] }
        ]},
        { id: "awards", label: "奖助与评优", icon: "☆", subgroups: [
          { label: "奖学金", tags: ["国家奖学金", "国家励志奖学金", "学业奖学金", "社会奖学金", "至善/校长奖学金"] },
          { label: "资助", tags: ["助学金", "困难补助"] },
          { label: "评优评先", tags: ["评优评先", "优秀毕业生", "三好学生"] }
        ]},
        { id: "global", label: "国际与交流", icon: "◎", subgroups: [
          { label: "国际交流", tags: ["来华留学", "港澳台交流", "国际会议", "国际组织"] }
        ]},
        { id: "alumni", label: "毕业与校友", icon: "⚑", subgroups: [
          { label: "毕业与校友", tags: ["校友", "校友会", "校友活动", "档案户口", "捐赠"] }
        ]},
        { id: "governance", label: "校务与公告", icon: "▥", subgroups: [
          { label: "校务与组织", tags: ["规章制度", "入党", "理论学习", "青马工程", "主题团日", "人文东大"] }
        ]}
      ] as const;
export const OPTIMIZED_TOPIC_NAMES = new Set<string>(OPTIMIZED_TOPIC_GROUPS.flatMap(g => g.subgroups.flatMap(s => [...s.tags])));
