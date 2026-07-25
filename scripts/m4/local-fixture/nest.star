nest(
    name = "contract-probe",
    chain = "mainnet",
    chain_id = 1,
    rpc_urls = ["http://127.0.0.1:1"],
    contracts = [
        contract(
            alias = "probe",
            address = "0x0000000000000000000000000000000000000001",
            start_block = 1,
            abi = "abis/probe.json",
            events = ["Probe"],
        ),
    ],
)
