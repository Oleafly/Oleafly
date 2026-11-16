sub oleafly_indexer {
    my ($program) = split(q/ /, $makeindex // q/makeindex/);
    return (defined $program && $program ne q//) ? $program : q/makeindex/;
}

sub oleafly_mi {
    my ($path, $style, $log, $out, $in) = @_;
    my $base = basename($path);
    local $ENV{openin_any} = q/r/;
    pushd(dirname($path));
    my $sheet = $style // qq/$base.ist/;
    my @order = ();
    if (!defined $style && open(my $aux, q/</, qq/$base.aux/)) {
        for (<$aux>) {
            @order = (q/-l/) if /\\\@glsorder\{letter\}/;
            $sheet = basename($1) if /\\\@istfilename\{([^}]+\.ist)\}/;
        }
        close($aux);
    }
    my $code = 0;
    if (defined $style || -e $sheet) {
        my @command = (oleafly_indexer(), @order, q/-s/, $sheet, q/-t/, qq/$base.$log/, q/-o/, qq/$base.$out/, qq/$base.$in/);
        print qq/Running '@command'\n/;
        $code = system(@command);
    } elsif (open(my $empty, q/>/, qq/$base.$out/)) {
        close($empty);
    }
    popd();
    return $code;
}

add_cus_dep(q/glo/, q/gls/, 0, q/oleafly_glo/);
sub oleafly_glo { oleafly_mi($_[0], undef, q/glg/, q/gls/, q/glo/) }

add_cus_dep(q/acn/, q/acr/, 0, q/oleafly_acn/);
sub oleafly_acn { oleafly_mi($_[0], undef, q/alg/, q/acr/, q/acn/) }

add_cus_dep(q/nlo/, q/nls/, 0, q/oleafly_nlo/);
sub oleafly_nlo {
    my $glossary = 0;
    if (open(my $list, q/</, qq/$_[0].nlo/)) {
        $glossary = grep { /^\\glossaryentry/ } <$list>;
        close($list);
    }
    oleafly_mi($_[0], $glossary ? undef : q/nomencl.ist/, q/nlg/, q/nls/, q/nlo/)
}

add_cus_dep(q/slo/, q/sls/, 0, q/oleafly_slo/);
sub oleafly_slo { oleafly_mi($_[0], undef, q/slg/, q/sls/, q/slo/) }

push @generated_exts, q/glstex/, q/glg/;
add_cus_dep(q/aux/, q/glstex/, 0, q/oleafly_bib2gls/);
sub oleafly_bib2gls {
    my ($base, $dir) = fileparse($_[0]);
    my $resources = 0;
    if (open(my $aux, q/</, qq/$_[0].aux/)) {
        $resources = grep { /\\glsxtr\@resource\{/ } <$aux>;
        close($aux);
    }
    if (!$resources) {
        if (open(my $empty, q/>/, qq/$_[0].glstex/)) {
            close($empty);
        }
        return 0;
    }
    local $ENV{openin_any} = q/r/;
    my @command = (q/bib2gls/, q/--tex-encoding/, q/UTF-8/, q/--log-encoding/, q/UTF-8/, q/--group/, q/--dir/, $dir, $base);
    print qq/Running '@command'\n/;
    my $code = system(@command);
    if ($code == 0 && defined &rdb_ensure_file && open(my $log, q/</, qq/$_[0].glg/)) {
        while (<$log>) {
            rdb_ensure_file($rule, $1) if /^Reading\s+(.+\.(?:bib|aux))\s*$/;
        }
        close($log);
    }
    return $code;
}
