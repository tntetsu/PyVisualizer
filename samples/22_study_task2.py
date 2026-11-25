# [Task 2] fib(4) を実行するとき、
# fib という関数は合計で何回呼ばれますか？
# （最初の fib(4) の呼び出しも 1 回として数えてください）

def fib(n):
    if n <= 1:
        return n
    return fib(n - 1) + fib(n - 2)

print(fib(4))
