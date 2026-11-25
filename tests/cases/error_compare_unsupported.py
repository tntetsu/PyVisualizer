class P:
    def __lt__(self, other):
        return True
print(P() >= P())
