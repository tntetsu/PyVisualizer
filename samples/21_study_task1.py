# [Task 1] このコードにはバグがあります。
# 実行すると結果が [1, 2, 3, 5, 8, 9] になりません。
# ツールを使ってバグの原因を見つけ、どの行を修正すべきか答えてください。

def selection_sort(arr):
    n = len(arr)
    for i in range(n - 1):
        min_idx = i + 1
        for j in range(i + 1, n):
            if arr[j] < arr[min_idx]:
                min_idx = j
        temp = arr[i]
        arr[i] = arr[min_idx]
        arr[min_idx] = temp
    return arr

arr = [5, 3, 8, 1, 9, 2]
print(selection_sort(arr))
