# Service Dependency Graph

```mermaid
flowchart TB

  %% Service Dependency Graph

  Database{{{"Database\n(2 methods)"}}}
  Config{{{"Config\n(2 methods)"}}}
  Logger{{{"Logger\n(3 methods)"}}}
  Refunds{{{"Refunds\n(1 method)"}}}
  Notifications{{{"Notifications\n(1 method)"}}}
  Accounts{{{"Accounts\n(2 methods)"}}}
  TransferValidation{{{"TransferValidation\n(1 method)"}}}
  ExchangeRates{{{"ExchangeRates\n(1 method)"}}}
  FraudScreening{{{"FraudScreening\n(1 method)"}}}
  Transfers{{{"Transfers\n(1 method)"}}}
  AccountService{{{"AccountService\n(3 methods)"}}}
  AuditLog{{{"AuditLog\n(1 method)"}}}
  UserId{{{"UserId\n(50 methods)"}}}
  HttpClient{{{"HttpClient\n(4 methods)"}}}
  Cache{{{"Cache\n(3 methods)"}}}
  RateLimiter{{{"RateLimiter"}}}
  UserRepo{{{"UserRepo\n(1 method)"}}}
  Fixtures_UserRepo{{{"Fixtures/UserRepo\n(2 methods)"}}}
  Fixtures_AppConfig{{{"Fixtures/AppConfig"}}}
  Fixtures_CustomService{{{"Fixtures/CustomService\n(2 methods)"}}}
  Fixtures_Db{{{"Fixtures/Db\n(1 method)"}}}
  UserRepoService{{{"UserRepoService\n(1 method)"}}}
  MyPoint{{{"MyPoint"}}}
  AppConfig{{{"AppConfig"}}}
  CustomService{{{"CustomService\n(2 methods)"}}}
  Db{{{"Db\n(1 method)"}}}
  unresolved_Effect["? Effect"]
  unresolved_DevTools["? DevTools"]
  unresolved___Users_jreehal_dev_node_examples_effect_analyzer_node_modules__pnpm_effect_3_21_2_node_modules_effect_dist_dts_Effect_["? "/Users/jreehal/dev/node-examples/effect-analyzer/node_modules/.pnpm/effect@3.21.2/node_modules/effect/dist/dts/Effect""]
  unresolved_Layer["? Layer"]
  unresolved___Users_jreehal_dev_node_examples_effect_analyzer_node_modules__pnpm_effect_3_21_2_node_modules_effect_dist_dts_RcRef_["? "/Users/jreehal/dev/node-examples/effect-analyzer/node_modules/.pnpm/effect@3.21.2/node_modules/effect/dist/dts/RcRef""]
  unresolved___object["? __object"]
  unresolved_InternalLayer["? InternalLayer"]
  unresolved_InternalPubSub["? InternalPubSub"]
  unresolved_SqlClient["? SqlClient"]
  unresolved_AnalyzeResult["? AnalyzeResult"]
  unresolved_AnalyzeSourceResult["? AnalyzeSourceResult"]
  unresolved___Users_jreehal_dev_node_examples_effect_analyzer_node_modules__pnpm_effect_3_21_2_node_modules_effect_dist_dts_Console_["? "/Users/jreehal/dev/node-examples/effect-analyzer/node_modules/.pnpm/effect@3.21.2/node_modules/effect/dist/dts/Console""]
  unresolved_AnalyzerDeps["? AnalyzerDeps"]
  unresolved_DateConstructor["? DateConstructor"]

  Fixtures_CustomService -->|"LayerGraph"| Fixtures_CustomService

  classDef service fill:#E3F2FD,stroke:#1565C0,stroke-width:2px
  classDef unresolved fill:#FFF3CD,stroke:#856404,stroke-dasharray:5
  class Database service
  class Config service
  class Logger service
  class Refunds service
  class Notifications service
  class Accounts service
  class TransferValidation service
  class ExchangeRates service
  class FraudScreening service
  class Transfers service
  class AccountService service
  class AuditLog service
  class UserId service
  class HttpClient service
  class Cache service
  class RateLimiter service
  class UserRepo service
  class Fixtures_UserRepo service
  class Fixtures_AppConfig service
  class Fixtures_CustomService service
  class Fixtures_Db service
  class UserRepoService service
  class MyPoint service
  class AppConfig service
  class CustomService service
  class Db service
  class unresolved_Effect unresolved
  class unresolved_DevTools unresolved
  class unresolved___Users_jreehal_dev_node_examples_effect_analyzer_node_modules__pnpm_effect_3_21_2_node_modules_effect_dist_dts_Effect_ unresolved
  class unresolved_Layer unresolved
  class unresolved___Users_jreehal_dev_node_examples_effect_analyzer_node_modules__pnpm_effect_3_21_2_node_modules_effect_dist_dts_RcRef_ unresolved
  class unresolved___object unresolved
  class unresolved_InternalLayer unresolved
  class unresolved_InternalPubSub unresolved
  class unresolved_SqlClient unresolved
  class unresolved_AnalyzeResult unresolved
  class unresolved_AnalyzeSourceResult unresolved
  class unresolved___Users_jreehal_dev_node_examples_effect_analyzer_node_modules__pnpm_effect_3_21_2_node_modules_effect_dist_dts_Console_ unresolved
  class unresolved_AnalyzerDeps unresolved
  class unresolved_DateConstructor unresolved
```
