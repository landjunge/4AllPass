"""Protected API building block; no CLI/server or production secret handoff.

Only a separately trusted host may instantiate this core. Keeping this module in
another process under the same OS user is NOT an isolation guarantee.
"""
