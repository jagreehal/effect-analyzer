# Service Dependency Graph

```mermaid
flowchart TB

  %% Service Dependency Graph

  Database{{{"Database\n(2 methods)"}}}
  Config{{{"Config\n(2 methods)"}}}
  Logger{{{"Logger\n(3 methods)"}}}
  UserId{{{"UserId\n(46 methods)"}}}
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

  UserRepoService -->|"liveRepoLayer"| UserRepoService
  CustomService -->|"LayerGraph"| CustomService

  classDef service fill:#E3F2FD,stroke:#1565C0,stroke-width:2px
  classDef unresolved fill:#FFF3CD,stroke:#856404,stroke-dasharray:5
  class Database service
  class Config service
  class Logger service
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
```
