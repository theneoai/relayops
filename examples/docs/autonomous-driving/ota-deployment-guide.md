# 自动驾驶OTA升级部署指南 v3.0

## 1. 概述

本文档描述了自动驾驶软件的OTA（Over-The-Air）升级流程，包括升级包制作、分发、安装和回滚机制。

## 2. 升级包格式

### 2.1 包结构
```
ota_package_v{X.Y.Z}.tar.gz
├── manifest.json          # 包清单
├── signature.sig          # 数字签名
├── ecu_updates/
│   ├── perception/        # 感知模块
│   ├── planning/          # 规划模块
│   ├── control/           # 控制模块
│   ├── localization/      # 定位模块
│   └── system/            # 系统模块
├── config/
│   ├── calibration/       # 标定参数
│   └── maps/              # 地图数据
└── scripts/
    ├── pre_install.sh     # 安装前检查
    ├── install.sh         # 安装脚本
    └── post_install.sh    # 安装后验证
```

### 2.2 Manifest格式
```json
{
  "version": "3.2.1",
  "release_date": "2026-04-25",
  "target_platforms": ["orin-x", "x86_64"],
  "ecu_list": ["perception", "planning", "control"],
  "size_mb": 2048,
  "sha256": "abc123...",
  "prerequisites": {
    "min_version": "3.0.0",
    "required_space_mb": 4096,
    "compatible_hardware": ["hw_rev_2.1", "hw_rev_2.2"]
  },
  "rollback_support": true,
  "downtime_seconds": 120
}
```

## 3. 升级策略

### 3.1 分阶段发布
1. **Alpha阶段**: 内部测试车队（10辆），持续3天
2. **Beta阶段**: 试点城市车队（100辆），持续7天
3. **Gamma阶段**: 扩展区域（1000辆），持续14天
4. **全量发布**: 所有车辆

### 3.2 发布条件
每个阶段必须满足：
- 系统故障率 < 0.1%
- 自动驾驶接管率无显著上升（< 基线 + 5%）
- 无P0/P1级别安全事件
- 客户投诉率 < 0.05%

### 3.3 紧急热修复
- 可跳过Alpha/Beta阶段
- 但必须经过完整的SIL测试
- 发布范围可限定到特定VIN列表
- 必须在24小时内完成全量发布

## 4. 安装流程

### 4.1 安装前检查
```bash
# 1. 电量检查
if battery < 30%: abort("电量不足")

# 2. 车速检查
if speed > 0: queue_install(when_parked=True)

# 3. 空间检查
if free_space < required_space * 1.5: abort("空间不足")

# 4. 版本兼容性
if current_version not in compatible_versions: abort("版本不兼容")

# 5. 硬件兼容性
if hw_revision not in compatible_hardware: abort("硬件不兼容")
```

### 4.2 安装过程
1. 下载升级包到临时分区
2. 验证签名和哈希
3. 备份当前版本到回滚分区
4. 执行pre_install脚本
5. 逐个ECU更新（A/B分区切换）
6. 执行post_install验证
7. 标记新分区为活跃
8. 重启系统

### 4.3 A/B分区机制
- 每个ECU有两个独立分区：A和B
- 当前运行的为活跃分区
- 升级在非活跃分区进行
- 安装完成后切换活跃标记
- 如启动失败，自动回滚到原分区

## 5. 回滚机制

### 5.1 自动回滚触发条件
- 新分区启动失败（3次尝试）
- 关键服务启动超时（> 60s）
- 安全自检未通过
- CAN通信异常

### 5.2 手动回滚
```bash
# 通过OTA服务触发
POST /api/v1/ota/rollback
{
  "target_version": "3.1.5",
  "reason": "performance_regression",
  "vin_list": ["ALL"],
  "immediate": false
}
```

### 5.3 回滚限制
- 最多保留2个历史版本
- 数据库schema变更后不可回滚
- 标定参数更新后回滚需重新标定

## 6. 安全机制

### 6.1 签名验证
- 使用ECDSA P-256签名
- 公钥烧录在TEE（可信执行环境）
- 升级包必须经过签名才能安装

### 6.2 加密传输
- TLS 1.3加密下载
- 支持断点续传
- 下载完成后本地解密

### 6.3 安全启动
- Secure Boot链验证
- 每个分区镜像必须签名
- 启动时验证哈希

## 7. 监控指标

| 指标 | 目标 | 告警阈值 |
|-----|------|---------|
| 下载成功率 | > 99.5% | < 99% |
| 安装成功率 | > 99.9% | < 99.5% |
| 平均安装时间 | < 5分钟 | > 10分钟 |
| 回滚率 | < 0.1% | > 0.5% |
| 升级后故障率 | < 0.05% | > 0.1% |

## 8. 应急响应

### 8.1 大规模升级失败
1. 立即暂停新车辆下载
2. 分析失败日志，定位根因
3. 如为软件缺陷，准备修复包
4. 如为基础设施问题，切换CDN
5. 通知受影响的运营团队

### 8.2 安全漏洞升级
1. 安全团队确认漏洞等级
2. 开发团队准备热修复
3. 绕过常规发布流程，直接全量发布
4. 通知监管部门（如需要）
5. 记录安全事件日志
