typescript=${typescript:-/tmp/oleafly-typescript}
exit_file=${exit_file:-/tmp/oleafly-exit}
out=${out:-/tmp/oleafly-out}

feed() {
	offset=0
	while [ $# -ge 2 ]; do
		tries=0
		until tail -c +"$((offset + 1))" "$typescript" 2>/dev/null | grep -qF -- "$1"; do
			[ ! -f "$exit_file" ] || return 0
			tries=$((tries + 1))
			[ "$tries" -lt "${feed_patience:-600}" ] || return 0
			/bin/sleep 0.1
		done
		offset=$(wc -c <"$typescript")
		printf '%s\n' "$2"
		shift 2
	done
	tries=0
	until [ -f "$exit_file" ] || [ "$tries" -ge "${feed_patience:-600}" ]; do
		tries=$((tries + 1))
		/bin/sleep 0.1
	done
}

run_in_terminal() {
	command_line=$1
	shift
	rm -f "$typescript" "$exit_file"
	: >"$typescript"
	feed "$@" | script -qfec "$command_line; echo \$? >$exit_file" "$typescript" >/dev/null 2>&1
	tr -d '\r' <"$typescript" >"$out"
	if [ -f "$exit_file" ]; then
		cat "$exit_file"
	else
		echo timeout
	fi
}
