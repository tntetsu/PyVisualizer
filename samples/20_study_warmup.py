# [Warm-up] 階乗（繰り返し版）
# 実行してからステップを進め、result の値がどう変化するか確認してください。
# いくつかのビューを切り替えて、使い方に慣れましょう。

def factorial(n):
    result = 1
    for i in range(1, n + 1):
        result = result * i
    return result

print(factorial(5))
