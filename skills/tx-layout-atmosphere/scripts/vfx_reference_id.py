"""Stable, source-neutral identifiers for candidate and delivery views."""
from hashlib import sha256
import re


def public_id(value):
    if re.fullmatch(r'ref_[a-f0-9]{16}', value):
        return value
    return 'ref_' + sha256(value.encode('utf-8')).hexdigest()[:16]
