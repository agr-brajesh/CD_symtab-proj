# Symbol-table project - build helper (needs g++ with C++17 and GNU make)
CXX      ?= g++
CXXFLAGS ?= -O2 -std=c++17 -Wall -Wextra
SRC      = source

all: benchmark symtab_cli experiments

benchmark: $(SRC)/symtab.cpp $(SRC)/benchmark.cpp $(SRC)/symtab.h
	$(CXX) $(CXXFLAGS) -o $@ $(SRC)/symtab.cpp $(SRC)/benchmark.cpp

symtab_cli: $(SRC)/symtab.cpp $(SRC)/symtab_cli.cpp $(SRC)/symtab.h
	$(CXX) $(CXXFLAGS) -o $@ $(SRC)/symtab.cpp $(SRC)/symtab_cli.cpp

experiments: $(SRC)/symtab.cpp $(SRC)/experiments.cpp $(SRC)/symtab.h
	$(CXX) $(CXXFLAGS) -o $@ $(SRC)/symtab.cpp $(SRC)/experiments.cpp

test_correctness: tests/test_correctness.cpp $(SRC)/symtab.cpp $(SRC)/symtab.h
	$(CXX) -O1 -g -fsanitize=address,undefined -std=c++17 -Wall -Wextra -I$(SRC) -o $@ tests/test_correctness.cpp $(SRC)/symtab.cpp

test: test_correctness
	./test_correctness

clean:
	rm -f benchmark symtab_cli experiments test_correctness

.PHONY: all test clean
