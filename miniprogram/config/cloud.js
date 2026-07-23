// 云开发环境配置
//
// 环境 ID 是「环境相关配置」，集中在此一处管理，业务代码只引用符号名，
// 不在各处硬编码字面量（对齐项目「禁止硬编码」约束）。
// 切换环境（如日后新增测试环境）只需改这里。
//
// 类比 Android：相当于 BuildConfig 里的环境常量。

const CLOUD_ENV = {
  // 微信开发者工具「云开发」控制台创建的环境 ID（非环境名称）
  DEFAULT: 'cloudbase-d1gtv92iac778b581',
};

module.exports = { CLOUD_ENV };
