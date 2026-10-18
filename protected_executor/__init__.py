"""Fixed synthetic API building block; production host unavailable.

Normal calls without a supported host fail closed before grant lookup. Only an
explicit fixed-secret SyntheticHostCapability exists for synthetic tests. This
module is neither a protected OS boundary nor a real vault-transfer connector.
"""
