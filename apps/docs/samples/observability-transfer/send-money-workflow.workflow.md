flowchart LR
  VT["validateTransfer"] -->|ok| FR["fetchRate"]
  FR["fetchRate"] -->|ok| GB["getBalance"]
  GB["getBalance"] -->|ok| R["resolve"]
  R["resolve"] -->|ok| ET["executeTransfer"]
  ET["executeTransfer"] -->|ok| SC["sendConfirmation"]
  SC["sendConfirmation"] -->|ok| Done((Success))
  VT -->|err| VTE["ValidationError"]
  FR -->|err| FRE["RateUnavailableError"]
  R -->|err| RE["InsufficientFundsError"]
  ET -->|err| ETE["TransferRejectedError / ProviderUnavailableError"]
  SC -->|err| SCE["ConfirmationFailedError"]

  classDef stepStyle fill:#e1f5fe,stroke:#01579b
  classDef errorStyle fill:#ffcdd2,stroke:#c62828
  classDef successStyle fill:#c8e6c9,stroke:#2e7d32
  class VT,FR,GB,R,ET,SC stepStyle
  class VTE,FRE,RE,ETE,SCE errorStyle
  class Done successStyle