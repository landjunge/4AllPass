import enum


class EnvelopeType(str, enum.Enum):
    """KeyEnvelope.type — crypto-protocol.md §3."""

    MASTER = "master"
    DEVICE = "device"
    RECOVERY = "recovery"
