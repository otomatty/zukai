#!/bin/sh
# サンプルの2つのリポジトリを Git のリポジトリにする。
# リモートの URL から、zukai が接続先（CodeCommit か GitHub か）を読み取る。
set -e
cd "$(dirname "$0")/repos"
commit() {
  [ -d "$1/.git" ] && return
  git -C "$1" init -q -b main
  git -C "$1" remote add origin "$2"
  git -C "$1" add -A
  GIT_AUTHOR_DATE='2026-10-01T09:00:00+09:00' GIT_COMMITTER_DATE='2026-10-01T09:00:00+09:00' \
    git -C "$1" -c user.name=sample -c user.email=sample@example.com commit -q -m 'サンプルの初期構成'
  echo "$1: $(git -C "$1" rev-parse --short HEAD)"
}
commit order-api https://git-codecommit.ap-northeast-1.amazonaws.com/v1/repos/order-api
commit order-infra git@github.com:example-corp/order-infra.git
