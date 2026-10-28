//go:build p6e_fault && linux

package httpapi

// This file is excluded from production binaries. The dedicated P6-E local
// database fixture installs a trigger calling this fixed, zero-argument
// function. It holds the API while SQLite is executing the success UPDATE,
// allowing the harness to SIGKILL the process and test WAL crash recovery.
import (
	"database/sql/driver"
	"fmt"
	"time"

	"modernc.org/sqlite"
)

func init() {
	err := sqlite.RegisterScalarFunction("p6e_transaction_checkpoint", 0,
		func(_ *sqlite.FunctionContext, _ []driver.Value) (driver.Value, error) {
			fmt.Println("P6E_TEST_CHECKPOINT sqlite-success-transaction")
			for {
				time.Sleep(time.Hour)
			}
		})
	if err != nil {
		panic("test SQLite checkpoint registration failed")
	}
}
