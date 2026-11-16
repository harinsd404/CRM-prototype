"""로그인 계정을 만들거나 비밀번호를 바꾼다 (회원가입 화면은 없다).

    uv run python scripts/add_user.py <아이디> <비밀번호>
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.auth import set_user  # noqa: E402
from app.core.db import init_db  # noqa: E402


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    username, password = sys.argv[1].strip(), sys.argv[2]
    if not username or len(password) < 4:
        sys.exit("아이디는 비울 수 없고, 비밀번호는 4자 이상이어야 합니다.")
    init_db()
    created = set_user(username, password)
    print(f"계정을 {'만들었습니다' if created else '찾아 비밀번호를 바꿨습니다'}: {username}")


if __name__ == "__main__":
    main()
