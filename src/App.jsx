import { useEffect, useRef, useState } from "react";
import { Pie, Doughnut, Line, Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  ArcElement,
  BarElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
} from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";

import "./App.css";

ChartJS.register(
  ArcElement,
  BarElement,
  Tooltip,
  Legend,
  ChartDataLabels,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement
);

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

const expenseCategories = [
  "Food",
  "Transport",
  "Shopping",
  "Bills",
  "Entertainment",
  "Health",
  "Education",
  "Other",
];

const incomeCategories = [
  "Salary",
  "Freelance",
  "Business",
  "Investment",
  "Gift",
  "Other",
];

const TRANSACTIONS_PER_PAGE = 8;
const UNDO_WINDOW_MS = 5000;

// Shared options for the two labelled charts (pie / doughnut) — they only
// differ in their underlying data, not their display options.
const buildLabelledLegendOptions = () => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: "bottom",
      labels: {
        padding: 20,
        font: {
          size: 14,
        },
      },
    },
    datalabels: {
      color: "#ffffff",
      font: {
        weight: "bold",
        size: 12,
      },
      formatter: (value, context) => {
        const label = context.chart.data.labels[context.dataIndex];
        return `${label}\n₹${value}`;
      },
    },
  },
});

const buildBarOptions = () => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: "bottom",
    },
    datalabels: {
      display: false,
    },
  },
  scales: {
    y: {
      beginAtZero: true,
    },
  },
});

function ExpenseDashboard({
  authToken,
  currentUser,
  onLogout,
  darkMode,
  onToggleDarkMode,
}) {
  const [transactions, setTransactions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Food");
  const [transactionType, setTransactionType] = useState("expense");

  const [transactionDate, setTransactionDate] = useState(
    new Date().toISOString().split("T")[0]
  );

  const [editingId, setEditingId] = useState(null);
  const formCardRef = useRef(null);

  // Validation + duplicate detection
  const [fieldErrors, setFieldErrors] = useState({});
  const [duplicateWarning, setDuplicateWarning] = useState(null);

  // Toasts
  const [toasts, setToasts] = useState([]);

  // Undo-delete bookkeeping: id -> { transaction, timeoutId }
  const pendingDeletionsRef = useRef({});

  // Search and filters
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");

  // Sorting
  const [sortBy, setSortBy] = useState("newest");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);

  // Chart display type per panel
  const [categoryChartType, setCategoryChartType] = useState("pie");
  const [incomeExpenseChartType, setIncomeExpenseChartType] = useState("doughnut");
  const [monthlyChartType, setMonthlyChartType] = useState("line");

  // Detail pages for Balance / Income / Expenses
  const [detailPage, setDetailPage] = useState(null);
  const [selectedDetailMonth, setSelectedDetailMonth] = useState(
    new Date().toISOString().slice(0, 7)
  );

  // ---------- Toast helpers ----------
  const removeToast = (id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  const addToast = (message, type = "info", options = {}) => {
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;

    const duration = options.duration ?? 4000;

    setToasts((prev) => [
      ...prev,
      {
        id,
        message,
        type,
        actionLabel: options.actionLabel,
        onAction: options.onAction,
      },
    ]);

    setTimeout(() => removeToast(id), duration);

    return id;
  };

  // ---------- Data fetching ----------
  const fetchTransactions = async () => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const response = await fetch(`${API_URL}/transactions`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (response.status === 401) {
        onLogout();
        return;
      }

      if (!response.ok) {
        throw new Error("Failed to load transactions");
      }

      const data = await response.json();
      setTransactions(data);
    } catch (error) {
      console.error("Error fetching transactions:", error);
      setErrorMessage(
        "Couldn't load your transactions. Check that the server is running and try again."
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, [authToken]);

  // Reset to page 1 whenever the visible set of transactions changes shape
  useEffect(() => {
    setCurrentPage(1);
  }, [search, filterType, filterCategory, sortBy]);

  // Clear any pending undo-delete timeouts if the component unmounts
  useEffect(() => {
    return () => {
      Object.values(pendingDeletionsRef.current).forEach(({ timeoutId }) =>
        clearTimeout(timeoutId)
      );
    };
  }, []);

  // ---------- Form helpers ----------
  const resetForm = () => {
    setEditingId(null);
    setTitle("");
    setAmount("");
    setTransactionType("expense");
    setCategory(expenseCategories[0]);
    setTransactionDate(new Date().toISOString().split("T")[0]);
    setFieldErrors({});
    setDuplicateWarning(null);
  };

  const clearFieldError = (field) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const validateForm = () => {
    const errors = {};
    const trimmedTitle = title.trim();
    const numericAmount = Number(amount);

    if (!trimmedTitle) {
      errors.title = "Title is required.";
    } else if (trimmedTitle.length > 60) {
      errors.title = "Keep titles under 60 characters.";
    }

    if (amount === "" || Number.isNaN(numericAmount) || numericAmount <= 0) {
      errors.amount = "Enter an amount greater than 0.";
    }

    if (!transactionDate) {
      errors.date = "Date is required.";
    }

    return errors;
  };

  const findDuplicate = () => {
    const numericAmount = Number(amount);
    const trimmedTitle = title.trim().toLowerCase();

    return transactions.find(
      (transaction) =>
        transaction.id !== editingId &&
        transaction.title.trim().toLowerCase() === trimmedTitle &&
        Number(transaction.amount) === numericAmount &&
        transaction.category === category &&
        transaction.transaction_date === transactionDate
    );
  };

  // Actually sends the request — separated from addTransaction so the
  // duplicate-confirmation button can trigger it directly.
  const submitTransaction = async () => {
    const transactionData = {
      title: title.trim(),
      amount: Number(amount),
      category,
      transaction_type: transactionType,
      transaction_date: transactionDate,
    };

    try {
      const url = editingId
        ? `${API_URL}/transactions/${editingId}`
        : `${API_URL}/transactions`;

      const method = editingId ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(transactionData),
      });

      if (!response.ok) {
        throw new Error(
          editingId
            ? "Failed to update transaction"
            : "Failed to add transaction"
        );
      }

      const wasEditing = Boolean(editingId);
      resetForm();
      await fetchTransactions();
      addToast(wasEditing ? "Transaction updated." : "Transaction added.", "success");
    } catch (error) {
      console.error("Transaction error:", error);
      setErrorMessage(
        editingId
          ? "Couldn't update that transaction. Please try again."
          : "Couldn't add that transaction. Please try again."
      );
    }
  };

  const addTransaction = (event) => {
    event.preventDefault();
    setErrorMessage("");
    setDuplicateWarning(null);

    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    const duplicate = findDuplicate();
    if (duplicate) {
      setDuplicateWarning(
        "This looks like a duplicate of an existing transaction."
      );
      return;
    }

    submitTransaction();
  };

  const proceedDespiteDuplicate = () => {
    setDuplicateWarning(null);
    submitTransaction();
  };

  // ---------- Delete with undo ----------
  const finalizeDelete = async (id) => {
    const pending = pendingDeletionsRef.current[id];
    if (!pending) return;

    delete pendingDeletionsRef.current[id];

    try {
      const response = await fetch(`${API_URL}/transactions/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to delete transaction");
      }
    } catch (error) {
      console.error("Error deleting transaction:", error);
      setErrorMessage(
        "Couldn't delete that transaction on the server. Refreshing your list."
      );
      fetchTransactions();
    }
  };

  const undoDelete = (id) => {
    const pending = pendingDeletionsRef.current[id];
    if (!pending) return;

    clearTimeout(pending.timeoutId);
    delete pendingDeletionsRef.current[id];

    setTransactions((prev) => [...prev, pending.transaction]);
  };

  const deleteTransaction = (transaction) => {
    const { id } = transaction;

    // Optimistic removal — the actual API call is deferred until the undo
    // window closes, so clicking Undo never has to "un-delete" anything.
    setTransactions((prev) => prev.filter((item) => item.id !== id));

    if (editingId === id) {
      resetForm();
    }

    const timeoutId = setTimeout(() => finalizeDelete(id), UNDO_WINDOW_MS);
    pendingDeletionsRef.current[id] = { transaction, timeoutId };

    addToast(`Deleted "${transaction.title}".`, "info", {
      actionLabel: "Undo",
      onAction: () => undoDelete(id),
      duration: UNDO_WINDOW_MS,
    });
  };

  // ---------- Edit ----------
  const editTransaction = (transaction) => {
    setEditingId(transaction.id);
    setTitle(transaction.title);
    setAmount(transaction.amount);
    setCategory(transaction.category);
    setTransactionType(transaction.transaction_type);
    setTransactionDate(transaction.transaction_date);
    setFieldErrors({});
    setDuplicateWarning(null);

    formCardRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  // ---------- Totals ----------
  const totalIncome = transactions
    .filter((transaction) => transaction.transaction_type === "income")
    .reduce((total, transaction) => total + Number(transaction.amount), 0);

  const totalExpense = transactions
    .filter((transaction) => transaction.transaction_type === "expense")
    .reduce((total, transaction) => total + Number(transaction.amount), 0);

  const balance = totalIncome - totalExpense;

  // ---------- Filter + sort + paginate ----------
  const filteredTransactions = transactions.filter((transaction) => {
    const matchesSearch = transaction.title
      .toLowerCase()
      .includes(search.toLowerCase());

    const matchesType =
      filterType === "all" || transaction.transaction_type === filterType;

    const matchesCategory =
      filterCategory === "all" || transaction.category === filterCategory;

    return matchesSearch && matchesType && matchesCategory;
  });

  const sortedTransactions = [...filteredTransactions].sort((a, b) => {
    if (sortBy === "newest") {
      return new Date(b.transaction_date) - new Date(a.transaction_date);
    }

    if (sortBy === "oldest") {
      return new Date(a.transaction_date) - new Date(b.transaction_date);
    }

    if (sortBy === "highest") {
      return Number(b.amount) - Number(a.amount);
    }

    if (sortBy === "lowest") {
      return Number(a.amount) - Number(b.amount);
    }

    return 0;
  });

  const totalPages = Math.max(
    1,
    Math.ceil(sortedTransactions.length / TRANSACTIONS_PER_PAGE)
  );

  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedTransactions = sortedTransactions.slice(
    (safeCurrentPage - 1) * TRANSACTIONS_PER_PAGE,
    safeCurrentPage * TRANSACTIONS_PER_PAGE
  );

  // ---------- Chart data ----------
  const categoryData = Object.values(
    transactions
      .filter((transaction) => transaction.transaction_type === "expense")
      .reduce((acc, transaction) => {
        const category = transaction.category;

        if (!acc[category]) {
          acc[category] = {
            name: category,
            value: 0,
          };
        }

        acc[category].value += Number(transaction.amount);

        return acc;
      }, {})
  );

  const categoryPieData = {
    labels: categoryData.map((item) => item.name),
    datasets: [
      {
        label: "Expenses",
        data: categoryData.map((item) => item.value),
        backgroundColor: [
          "#6366f1",
          "#ec4899",
          "#f59e0b",
          "#10b981",
          "#3b82f6",
          "#8b5cf6",
          "#ef4444",
        ],
        borderColor: "#ffffff",
        borderWidth: 2,
      },
    ],
  };

  const categoryBarData = {
    labels: categoryData.map((item) => item.name),
    datasets: [
      {
        label: "Expenses",
        data: categoryData.map((item) => item.value),
        backgroundColor: "#6366f1",
        borderRadius: 6,
      },
    ],
  };

  const incomeExpenseDoughnutData = {
    labels: ["Income", "Expenses"],
    datasets: [
      {
        label: "Amount",
        data: [totalIncome, totalExpense],
        backgroundColor: ["#22c55e", "#ef4444"],
        borderColor: "#ffffff",
        borderWidth: 2,
      },
    ],
  };

  const incomeExpenseBarData = {
    labels: ["Income", "Expenses"],
    datasets: [
      {
        label: "Amount",
        data: [totalIncome, totalExpense],
        backgroundColor: ["#22c55e", "#ef4444"],
        borderRadius: 6,
      },
    ],
  };

  const monthlyData = {};

  transactions.forEach((transaction) => {
    const date = new Date(transaction.transaction_date);

    const month = date.toLocaleString("default", {
      month: "short",
      year: "numeric",
    });

    if (!monthlyData[month]) {
      monthlyData[month] = {
        income: 0,
        expense: 0,
      };
    }

    monthlyData[month][transaction.transaction_type] += Number(
      transaction.amount
    );
  });

  const months = Object.keys(monthlyData);

  const monthlyLineData = {
    labels: months,
    datasets: [
      {
        label: "Income",
        data: months.map((month) => monthlyData[month].income),
        borderColor: "#22c55e",
        backgroundColor: "#22c55e",
        tension: 0.3,
      },
      {
        label: "Expenses",
        data: months.map((month) => monthlyData[month].expense),
        borderColor: "#ef4444",
        backgroundColor: "#ef4444",
        tension: 0.3,
      },
    ],
  };

  const monthlyBarData = {
    labels: months,
    datasets: [
      {
        label: "Income",
        data: months.map((month) => monthlyData[month].income),
        backgroundColor: "#22c55e",
        borderRadius: 6,
      },
      {
        label: "Expenses",
        data: months.map((month) => monthlyData[month].expense),
        backgroundColor: "#ef4444",
        borderRadius: 6,
      },
    ],
  };

  // ---------- Detail pages ----------
  const detailMonths = Array.from(
    new Set(
      transactions
        .map((transaction) => String(transaction.transaction_date || "").slice(0, 7))
        .filter(Boolean)
    )
  ).sort((a, b) => b.localeCompare(a));

  const availableDetailMonths =
    detailMonths.length > 0
      ? detailMonths
      : [new Date().toISOString().slice(0, 7)];

  const formatMonth = (monthKey) => {
    const date = new Date(`${monthKey}-01T00:00:00`);
    return date.toLocaleString("default", {
      month: "long",
      year: "numeric",
    });
  };

  const openDetailPage = (page) => {
    setDetailPage(page);
    if (!availableDetailMonths.includes(selectedDetailMonth)) {
      setSelectedDetailMonth(availableDetailMonths[0]);
    }
  };

  const selectedMonthTransactions = transactions.filter(
    (transaction) =>
      String(transaction.transaction_date || "").slice(0, 7) === selectedDetailMonth
  );

  const selectedMonthIncome = selectedMonthTransactions
    .filter((transaction) => transaction.transaction_type === "income")
    .reduce((total, transaction) => total + Number(transaction.amount), 0);

  const selectedMonthExpense = selectedMonthTransactions
    .filter((transaction) => transaction.transaction_type === "expense")
    .reduce((total, transaction) => total + Number(transaction.amount), 0);

  const selectedMonthBalance = selectedMonthIncome - selectedMonthExpense;

  const monthlySummary = availableDetailMonths.map((month) => {
    const monthTransactions = transactions.filter(
      (transaction) =>
        String(transaction.transaction_date || "").slice(0, 7) === month
    );

    const income = monthTransactions
      .filter((transaction) => transaction.transaction_type === "income")
      .reduce((total, transaction) => total + Number(transaction.amount), 0);

    const expense = monthTransactions
      .filter((transaction) => transaction.transaction_type === "expense")
      .reduce((total, transaction) => total + Number(transaction.amount), 0);

    return {
      month,
      income,
      expense,
      balance: income - expense,
    };
  });

  const selectedCategoryTotals = Object.values(
    selectedMonthTransactions
      .filter((transaction) => transaction.transaction_type === "expense")
      .reduce((acc, transaction) => {
        const name = transaction.category || "Other";
        if (!acc[name]) acc[name] = { name, value: 0 };
        acc[name].value += Number(transaction.amount);
        return acc;
      }, {})
  ).sort((a, b) => b.value - a.value);

  const detailTransactions = [...selectedMonthTransactions].sort(
    (a, b) => new Date(b.transaction_date) - new Date(a.transaction_date)
  );

  const renderDetailPage = () => {
    if (!detailPage) return null;

    const pageTitle =
      detailPage === "income"
        ? "Income Details"
        : detailPage === "expense"
        ? "Expense Details"
        : "Balance Details";

    const pageTotal =
      detailPage === "income"
        ? selectedMonthIncome
        : detailPage === "expense"
        ? selectedMonthExpense
        : selectedMonthBalance;

    const visibleTransactions =
      detailPage === "income"
        ? detailTransactions.filter((t) => t.transaction_type === "income")
        : detailPage === "expense"
        ? detailTransactions.filter((t) => t.transaction_type === "expense")
        : detailTransactions;

    return (
      <div className={`app ${darkMode ? "dark" : ""}`}>
        <header className="header">
          <div className="app-header">
            <div>
              <h1>ExpenseFlow</h1>
              <p>{pageTitle}</p>
            </div>
            <div className="header-actions">
              
              <button
                className="theme-toggle"
                onClick={() => setDarkMode(!darkMode)}
              >
                {darkMode ? "☀️ Light" : "🌙 Dark"}
              </button>
            </div>
          </div>
        </header>

        <main className="container">
          <button
            type="button"
            onClick={() => setDetailPage(null)}
            style={{
              marginBottom: "20px",
              padding: "10px 16px",
              border: "none",
              borderRadius: "10px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            ← Back to Dashboard
          </button>

          <section className="summary-grid">
            <div className="summary-card">
              <span>{pageTitle}</span>
              <h2>₹{pageTotal.toFixed(2)}</h2>
              <small>{formatMonth(selectedDetailMonth)}</small>
            </div>

            <div className="summary-card income-card">
              <span>Monthly Income</span>
              <h2>₹{selectedMonthIncome.toFixed(2)}</h2>
            </div>

            <div className="summary-card expense-card">
              <span>Monthly Expenses</span>
              <h2>₹{selectedMonthExpense.toFixed(2)}</h2>
            </div>
          </section>

          <section className="chart-card" style={{ marginBottom: "24px" }}>
            <div className="chart-header">
              <div>
                <h2>Month-wise Details</h2>
                <p>Select a month to see its complete financial activity.</p>
              </div>

              <select
                value={selectedDetailMonth}
                onChange={(event) => setSelectedDetailMonth(event.target.value)}
                aria-label="Select month"
              >
                {availableDetailMonths.map((month) => (
                  <option key={month} value={month}>
                    {formatMonth(month)}
                  </option>
                ))}
              </select>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "14px",
                marginTop: "20px",
              }}
            >
              <div className="summary-card">
                <span>Income</span>
                <h2>₹{selectedMonthIncome.toFixed(2)}</h2>
              </div>
              <div className="summary-card">
                <span>Expenses</span>
                <h2>₹{selectedMonthExpense.toFixed(2)}</h2>
              </div>
              <div className="summary-card">
                <span>Net Balance</span>
                <h2>₹{selectedMonthBalance.toFixed(2)}</h2>
              </div>
            </div>
          </section>

          {detailPage !== "balance" && selectedCategoryTotals.length > 0 && (
            <section className="chart-card" style={{ marginBottom: "24px" }}>
              <div className="chart-header">
                <div>
                  <h2>
                    {detailPage === "expense"
                      ? "Spending by Category"
                      : "Income by Category"}
                  </h2>
                  <p>{formatMonth(selectedDetailMonth)}</p>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: "12px",
                  marginTop: "18px",
                }}
              >
                {(detailPage === "income"
                  ? Object.values(
                      selectedMonthTransactions
                        .filter((t) => t.transaction_type === "income")
                        .reduce((acc, t) => {
                          const name = t.category || "Other";
                          if (!acc[name]) acc[name] = { name, value: 0 };
                          acc[name].value += Number(t.amount);
                          return acc;
                        }, {})
                    ).sort((a, b) => b.value - a.value)
                  : selectedCategoryTotals
                ).map((item) => (
                  <div key={item.name} className="transaction-item">
                    <div className="transaction-info">
                      <h3>{item.name}</h3>
                    </div>
                    <strong>₹{item.value.toFixed(2)}</strong>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="transactions-card" style={{ marginBottom: "24px" }}>
            <div className="transactions-header">
              <div>
                <h2>{formatMonth(selectedDetailMonth)} Transactions</h2>
                <span>{visibleTransactions.length} transaction(s)</span>
              </div>
            </div>

            {visibleTransactions.length === 0 ? (
              <div className="empty-state">
                <p>No transactions for this month.</p>
              </div>
            ) : (
              <div className="transaction-list">
                {visibleTransactions.map((transaction) => (
                  <div className="transaction-item" key={transaction.id}>
                    <div className="transaction-info">
                      <h3>{transaction.title}</h3>
                      <p>
                        {transaction.category} • {transaction.transaction_date}
                      </p>
                    </div>
                    <div
                      className={
                        transaction.transaction_type === "income"
                          ? "amount income"
                          : "amount expense"
                      }
                    >
                      {transaction.transaction_type === "income" ? "+" : "-"}₹
                      {Number(transaction.amount).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="transactions-card">
            <div className="transactions-header">
              <div>
                <h2>Month-wise Income & Expenses</h2>
                <span>Complete financial history</span>
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "12px" }}>Month</th>
                    <th style={{ textAlign: "right", padding: "12px" }}>Income</th>
                    <th style={{ textAlign: "right", padding: "12px" }}>Expenses</th>
                    <th style={{ textAlign: "right", padding: "12px" }}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlySummary.map((item) => (
                    <tr
                      key={item.month}
                      onClick={() => setSelectedDetailMonth(item.month)}
                      style={{ cursor: "pointer" }}
                    >
                      <td style={{ padding: "12px" }}>{formatMonth(item.month)}</td>
                      <td style={{ textAlign: "right", padding: "12px" }}>
                        ₹{item.income.toFixed(2)}
                      </td>
                      <td style={{ textAlign: "right", padding: "12px" }}>
                        ₹{item.expense.toFixed(2)}
                      </td>
                      <td style={{ textAlign: "right", padding: "12px" }}>
                        ₹{item.balance.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    );
  };

  // ---------- CSV export ----------
  const exportToCSV = () => {
    if (transactions.length === 0) {
      addToast("No transactions to export.", "error");
      return;
    }

    const headers = ["Title", "Amount", "Type", "Category", "Date"];

    const rows = transactions.map((transaction) => [
      transaction.title,
      transaction.amount,
      transaction.transaction_type,
      transaction.category,
      transaction.transaction_date,
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.setAttribute("download", "expenseflow-transactions.csv");

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
    addToast("Exported transactions.csv", "success");
  };

  if (detailPage) {
    return renderDetailPage();
  }

  return (
    <div className={`app ${darkMode ? "dark" : ""}`}>
      {/* HEADER */}
      <header className="header">
        <div className="app-header">
          <div>
            <h1>ExpenseFlow</h1>
            <p>Take control of your money.</p>
          </div>
          <div className="header-actions">
            <button
              className="theme-toggle"
              onClick={onToggleDarkMode}
            >
              {darkMode ? "☀️ Light" : "🌙 Dark"}
            </button>
            <div className="user-menu">
              <span className="user-greeting">
                Hello, {currentUser?.name || currentUser?.email || "User"}
              </span>
              <button className="logout-button" onClick={onLogout}>
                Log out
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="container">
        {errorMessage && (
          <div className="error-banner" role="alert">
            <span>{errorMessage}</span>
            <button
              className="error-dismiss"
              onClick={() => setErrorMessage("")}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}

        {/* SUMMARY CARDS */}
        <section className="summary-grid">
          <button
            type="button"
            className="summary-card balance-card"
            style={{ textAlign: "left", width: "100%", cursor: "pointer", font: "inherit" }}
            onClick={() => openDetailPage("balance")}
          >
            <span>Current Balance</span>
            <h2>₹{balance.toFixed(2)}</h2>
            <small>View details →</small>
          </button>

          <button
            type="button"
            className="summary-card income-card"
            style={{ textAlign: "left", width: "100%", cursor: "pointer", font: "inherit" }}
            onClick={() => openDetailPage("income")}
          >
            <span>Total Income</span>
            <h2>₹{totalIncome.toFixed(2)}</h2>
            <small>View details →</small>
          </button>

          <button
            type="button"
            className="summary-card expense-card"
            style={{ textAlign: "left", width: "100%", cursor: "pointer", font: "inherit" }}
            onClick={() => openDetailPage("expense")}
          >
            <span>Total Expenses</span>
            <h2>₹{totalExpense.toFixed(2)}</h2>
            <small>View details →</small>
          </button>
        </section>



        {/* FORM AND TRANSACTIONS */}
        <section className="content-grid">
          {/* FORM */}
          <div className="form-card" ref={formCardRef}>
            <h2>{editingId ? "Edit Transaction" : "Add Transaction"}</h2>

            {duplicateWarning && (
              <div className="duplicate-warning">
                <p>{duplicateWarning}</p>
                <div className="duplicate-warning-actions">
                  <button
                    type="button"
                    className="duplicate-confirm"
                    onClick={proceedDespiteDuplicate}
                  >
                    Add anyway
                  </button>
                  <button
                    type="button"
                    className="duplicate-cancel"
                    onClick={() => setDuplicateWarning(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <form onSubmit={addTransaction} noValidate>
              <div className="form-group">
                <label htmlFor="transaction-title">Title</label>
                <input
                  id="transaction-title"
                  type="text"
                  placeholder="e.g. Lunch"
                  value={title}
                  className={fieldErrors.title ? "has-error" : ""}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    clearFieldError("title");
                    setDuplicateWarning(null);
                  }}
                />
                {fieldErrors.title && (
                  <span className="field-error">{fieldErrors.title}</span>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="transaction-amount">Amount</label>
                <input
                  id="transaction-amount"
                  type="number"
                  placeholder="0.00"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  className={fieldErrors.amount ? "has-error" : ""}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    clearFieldError("amount");
                    setDuplicateWarning(null);
                  }}
                />
                {fieldErrors.amount && (
                  <span className="field-error">{fieldErrors.amount}</span>
                )}
              </div>

              {/* TYPE */}
              <div className="form-group">
                <label htmlFor="transaction-type">Type</label>
                <select
                  id="transaction-type"
                  value={transactionType}
                  onChange={(event) => {
                    const newType = event.target.value;
                    setTransactionType(newType);
                    setCategory(
                      newType === "income"
                        ? incomeCategories[0]
                        : expenseCategories[0]
                    );
                    setDuplicateWarning(null);
                  }}
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </div>

              {/* CATEGORY */}
              <div className="form-group">
                <label htmlFor="transaction-category">Category</label>
                <select
                  id="transaction-category"
                  value={category}
                  onChange={(event) => {
                    setCategory(event.target.value);
                    setDuplicateWarning(null);
                  }}
                >
                  {(transactionType === "income"
                    ? incomeCategories
                    : expenseCategories
                  ).map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              {/* DATE */}
              <div className="form-group">
                <label htmlFor="transaction-date">Date</label>
                <input
                  id="transaction-date"
                  type="date"
                  value={transactionDate}
                  className={fieldErrors.date ? "has-error" : ""}
                  onChange={(event) => {
                    setTransactionDate(event.target.value);
                    clearFieldError("date");
                    setDuplicateWarning(null);
                  }}
                />
                {fieldErrors.date && (
                  <span className="field-error">{fieldErrors.date}</span>
                )}
              </div>

              <div className="form-actions">
                <button type="submit" className="add-button">
                  {editingId ? "Update Transaction" : "+ Add Transaction"}
                </button>

                {editingId && (
                  <button
                    type="button"
                    className="cancel-button"
                    onClick={resetForm}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* TRANSACTIONS */}
          <div className="transactions-card">
            <div className="transactions-header">
              <div>
                <h2>Recent Transactions</h2>
                <span>{transactions.length} total</span>
              </div>

              <button className="export-button" onClick={exportToCSV}>
                Export CSV
              </button>
            </div>

            {/* FILTERS */}
            <div className="filters">
              {/* SEARCH */}
              <input
                type="text"
                placeholder="Search transactions..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search transactions"
              />

              {/* TYPE */}
              <select
                value={filterType}
                onChange={(event) => setFilterType(event.target.value)}
                aria-label="Filter by type"
              >
                <option value="all">All Types</option>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </select>

              {/* CATEGORY FILTER */}
              <select
                value={filterCategory}
                onChange={(event) => setFilterCategory(event.target.value)}
                aria-label="Filter by category"
              >
                <option value="all">All Categories</option>
                {[
                  ...new Set(
                    transactions.map((transaction) => transaction.category)
                  ),
                ]
                  .sort()
                  .map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
              </select>

              {/* SORT */}
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
                aria-label="Sort transactions"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="highest">Highest Amount</option>
                <option value="lowest">Lowest Amount</option>
              </select>
            </div>

            {/* TRANSACTION LIST */}
            {isLoading ? (
              <div className="empty-state">
                <p>Loading transactions…</p>
              </div>
            ) : sortedTransactions.length === 0 ? (
              <div className="empty-state">
                <p>No transactions found.</p>
                <span>Try changing your filters.</span>
              </div>
            ) : (
              <>
                <div className="transaction-list">
                  {paginatedTransactions.map((transaction) => (
                    <div className="transaction-item" key={transaction.id}>
                      <div className="transaction-info">
                        <h3>{transaction.title}</h3>
                        <p>
                          {transaction.category}
                          {" • "}
                          {transaction.transaction_date}
                        </p>
                      </div>

                      <div className="transaction-actions">
                        <div
                          className={
                            transaction.transaction_type === "income"
                              ? "amount income"
                              : "amount expense"
                          }
                        >
                          {transaction.transaction_type === "income"
                            ? "+"
                            : "-"}
                          ₹{Number(transaction.amount).toFixed(2)}
                        </div>

                        <button
                          className="edit-button"
                          onClick={() => editTransaction(transaction)}
                        >
                          Edit
                        </button>

                        <button
                          className="delete-button"
                          onClick={() => deleteTransaction(transaction)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {totalPages > 1 && (
                  <div className="pagination">
                    <button
                      type="button"
                      disabled={safeCurrentPage === 1}
                      onClick={() => setCurrentPage((page) => page - 1)}
                    >
                      Prev
                    </button>

                    <span>
                      Page {safeCurrentPage} of {totalPages}
                    </span>

                    <button
                      type="button"
                      disabled={safeCurrentPage === totalPages}
                      onClick={() => setCurrentPage((page) => page + 1)}
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
                {/* CHARTS */}
        <div className="charts-grid">
          {/* CATEGORY CHART */}
          <section className="chart-card">
            <div className="chart-header">
              <div>
                <h2>Spending by Category</h2>
                <p>Where your money is going</p>
              </div>

              <div className="chart-type-toggle" role="group" aria-label="Category chart type">
                <button
                  type="button"
                  className={categoryChartType === "pie" ? "active" : ""}
                  onClick={() => setCategoryChartType("pie")}
                >
                  Pie
                </button>
                <button
                  type="button"
                  className={categoryChartType === "bar" ? "active" : ""}
                  onClick={() => setCategoryChartType("bar")}
                >
                  Bar
                </button>
              </div>
            </div>

            {isLoading ? (
              <div className="chart-empty">
                <p>Loading…</p>
              </div>
            ) : categoryData.length === 0 ? (
              <div className="chart-empty">
                <p>No expense data available yet.</p>
              </div>
            ) : categoryChartType === "pie" ? (
              <div className="pie-chart-container">
                <Pie data={categoryPieData} options={buildLabelledLegendOptions()} />
              </div>
            ) : (
              <div className="pie-chart-container">
                <Bar data={categoryBarData} options={buildBarOptions()} />
              </div>
            )}
          </section>

          {/* INCOME VS EXPENSE */}
          <section className="chart-card">
            <div className="chart-header">
              <div>
                <h2>Income vs Expenses</h2>
                <p>Compare your total income and spending</p>
              </div>

              <div className="chart-type-toggle" role="group" aria-label="Income vs expenses chart type">
                <button
                  type="button"
                  className={incomeExpenseChartType === "doughnut" ? "active" : ""}
                  onClick={() => setIncomeExpenseChartType("doughnut")}
                >
                  Doughnut
                </button>
                <button
                  type="button"
                  className={incomeExpenseChartType === "bar" ? "active" : ""}
                  onClick={() => setIncomeExpenseChartType("bar")}
                >
                  Bar
                </button>
              </div>
            </div>

            {isLoading ? (
              <div className="chart-empty">
                <p>Loading…</p>
              </div>
            ) : transactions.length === 0 ? (
              <div className="chart-empty">
                <p>No transaction data available yet.</p>
              </div>
            ) : incomeExpenseChartType === "doughnut" ? (
              <div className="pie-chart-container">
                <Doughnut
                  data={incomeExpenseDoughnutData}
                  options={buildLabelledLegendOptions()}
                />
              </div>
            ) : (
              <div className="pie-chart-container">
                <Bar data={incomeExpenseBarData} options={buildBarOptions()} />
              </div>
            )}
          </section>

          {/* MONTHLY CHART */}
          <section className="chart-card monthly-chart">
            <div className="chart-header">
              <div>
                <h2>Monthly Overview</h2>
                <p>Track your income and expenses over time</p>
              </div>

              <div className="chart-type-toggle" role="group" aria-label="Monthly chart type">
                <button
                  type="button"
                  className={monthlyChartType === "line" ? "active" : ""}
                  onClick={() => setMonthlyChartType("line")}
                >
                  Line
                </button>
                <button
                  type="button"
                  className={monthlyChartType === "bar" ? "active" : ""}
                  onClick={() => setMonthlyChartType("bar")}
                >
                  Bar
                </button>
              </div>
            </div>

            {isLoading ? (
              <div className="chart-empty">
                <p>Loading…</p>
              </div>
            ) : months.length === 0 ? (
              <div className="chart-empty">
                <p>No transaction data available yet.</p>
              </div>
            ) : monthlyChartType === "line" ? (
              <div className="line-chart-container">
                <Line
                  data={monthlyLineData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: {
                        position: "bottom",
                      },
                      datalabels: {
                        display: false,
                      },
                    },
                  }}
                />
              </div>
            ) : (
              <div className="line-chart-container">
                <Bar data={monthlyBarData} options={buildBarOptions()} />
              </div>
            )}
          </section>
        </div>
      </main>

      {/* TOASTS */}
      {toasts.length > 0 && (
        <div className="toast-stack" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast-${toast.type}`}>
              <span>{toast.message}</span>
              <div className="toast-actions">
                {toast.actionLabel && (
                  <button
                    className="toast-action"
                    onClick={() => {
                      toast.onAction?.();
                      removeToast(toast.id);
                    }}
                  >
                    {toast.actionLabel}
                  </button>
                )}
                <button
                  className="toast-close"
                  onClick={() => removeToast(toast.id)}
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AuthScreen({ onAuthenticated, darkMode, onToggleDarkMode }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setError("");

    if (mode === "register" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/auth/login" : "/auth/register";
      const body =
        mode === "login"
          ? { email: email.trim().toLowerCase(), password }
          : { name: name.trim(), email: email.trim().toLowerCase(), password };

      const response = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || data.message || "Authentication failed.");
      }

      const token = data.access_token || data.token;
      if (!token) {
        throw new Error("Server did not return an access token.");
      }

      const user = data.user || {
        name: data.name || name,
        email: data.email || email,
      };

      localStorage.setItem("expenseflow_token", token);
      localStorage.setItem("expenseflow_user", JSON.stringify(user));
      onAuthenticated(token, user);
    } catch (err) {
      console.error("Authentication error:", err);
      setError(err.message || "Could not connect to the server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`app ${darkMode ? "dark" : ""}`}>
      <div className="auth-shell">
        <button
          type="button"
          className="auth-theme-toggle"
          onClick={onToggleDarkMode}
        >
          {darkMode ? "☀️ Light" : "🌙 Dark"}
        </button>
        <div className="auth-card">
        <div className="auth-brand">
          <h1>ExpenseFlow</h1>
          <p>{mode === "login" ? "Welcome back." : "Create your account."}</p>
        </div>

        <div className="auth-tabs">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => { setMode("login"); setError(""); }}
            type="button"
          >
            Login
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            onClick={() => { setMode("register"); setError(""); }}
            type="button"
          >
            Register
          </button>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={submit} className="auth-form">
          {mode === "register" && (
            <div className="form-group">
              <label htmlFor="auth-name">Name</label>
              <input
                id="auth-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
                required
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
          </div>

          {mode === "register" && (
            <div className="form-group">
              <label htmlFor="auth-confirm">Confirm Password</label>
              <input
                id="auth-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat your password"
                autoComplete="new-password"
                required
              />
            </div>
          )}

          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? "Please wait..." : mode === "login" ? "Login →" : "Create account →"}
          </button>
        </form>

        <p className="auth-switch">
          {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
          >
            {mode === "login" ? "Register" : "Login"}
          </button>
        </p>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem("theme") === "dark";
  });

  useEffect(() => {
    localStorage.setItem("theme", darkMode ? "dark" : "light");
  }, [darkMode]);
  const [auth, setAuth] = useState(() => {
    const token = localStorage.getItem("expenseflow_token");
    let user = null;
    try {
      user = JSON.parse(localStorage.getItem("expenseflow_user") || "null");
    } catch {
      user = null;
    }
    return token ? { token, user } : null;
  });

  const handleAuthenticated = (token, user) => setAuth({ token, user });

  const handleLogout = () => {
    localStorage.removeItem("expenseflow_token");
    localStorage.removeItem("expenseflow_user");
    setAuth(null);
  };

  if (!auth) {
    return (
      <AuthScreen
        onAuthenticated={handleAuthenticated}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((prev) => !prev)}
      />
    );
  }

  return (
    <ExpenseDashboard
      key={auth.token}
      authToken={auth.token}
      currentUser={auth.user}
      onLogout={handleLogout}
      darkMode={darkMode}
      onToggleDarkMode={() => setDarkMode((prev) => !prev)}
    />
  );
}

export default App;